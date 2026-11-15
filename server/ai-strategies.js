import {canAttack as canAttackVisible, effectiveDamage as effectiveVisibleDamage, previewUnitAttack} from "./combat-primitives.js";
import {mitigateKingDamage} from "./comeback-rules.js";

/**
 * Distinct AI curricula and a bounded search-based research challenger.
 * All policies operate on public board state and the AI's own hand only.
 * Never access hidden cards belonging to an opponent.
 */
/** Minimum public information allowed to influence AI opponent evaluation.
 * Do not copy hand, magic cards, resume token or socket identifiers.
 * The count of magic cards is already displayed to every player.
 */
export function publicOpponentForAI(player) {
  return {
    id: player.id, hp: player.hp, king: player.king,
    eliminated: !!player.eliminated,
    field: player.field.map(unit => ({...unit, status: [...(unit.status || [])]})),
    magicCount: Number.isInteger(player.magicCount) ? player.magicCount : player.magic?.length ?? 0
  };
}

/** Pure opponent-threat score using public game information only. */
export function scorePublicEnemyThreat(player,{playerCount,difficulty,genghisThreatWeight=2}){
  return player.hp * 0.8 +
    player.field.reduce((sum,unit)=>sum+effectiveVisibleDamage(unit)*(canAttackVisible(unit)?2:1),0) +
    player.magicCount * (player.field.some(unit=>unit.type==="法師")?3:0) -
    player.field.filter(unit=>unit.type==="步兵").length*4 +
    (playerCount>=3 && difficulty==="hard" && player.king?.name==="成吉思汗"
      ? Math.max(0,Number(genghisThreatWeight))*2 : 0);
}

/** Research-only strategy opponents. No altered cards, HP, draws or hidden information. */
export const STRATEGY_ARCHETYPES = Object.freeze([
  "balanced","rush","fortress","arcane","economy","counter"
]);

export function scoreArchetypeDeployment(card,self,opponent,style="balanced") {
  if(!STRATEGY_ARCHETYPES.includes(style))throw new Error("unknown strategy style");
  if(style==="balanced")return 0;
  if(style==="rush")return card.type==="騎兵" ? 32 : card.rank==="高級" ? -8 : 0;
  if(style==="fortress")return card.type==="步兵"
    ? (self.field.some(u=>u.type==="步兵")?12:36) : 0;
  if(style==="arcane")return card.type==="法師"
    ? (self.field.some(u=>u.type==="法師")?10:42) : 0;
  if(style==="economy")return card.rank==="高級" ? 30 : card.rank==="中級" ? 12 : 0;
  return opponent?.field?.some(unit=>unit.type===card.counterTarget) ? 34 : 0;
}

/**
 * Duel adversarial policy, using public target units and the challenger's own
 * board only. Research challenger only: never changes move legality or live AI.
 */
export function scoreArchetypeAttack({style="balanced",self,enemy,attacker,defender}) {
  if(!STRATEGY_ARCHETYPES.includes(style))throw new Error("unknown strategy style");
  if(style==="balanced")return 0;
  const ownGuards=self.field.filter(unit=>unit.type==="步兵").length;
  const isKing=!defender;
  const lastEnemyGuard=defender?.type==="步兵"&&enemy.field.filter(unit=>unit.type==="步兵").length===1;
  const losingGuard=attacker.type==="步兵"&&ownGuards===1;
  if(style==="rush")return (isKing?46:0)+(lastEnemyGuard?36:0)+(attacker.type==="騎兵"?14:0);
  if(style==="fortress")return (losingGuard?-82:0)+(isKing&&ownGuards===0?-32:0);
  if(style==="arcane")return (attacker.type==="法師"?-27:0)+(defender?.type==="法師"?25:0);
  if(style==="economy")return (attacker.rank==="高級"&&defender?.rank==="初級"?-28:0)+(isKing?8:0);
  return defender&&attacker.counterTarget===defender.type?32:0;
}

/** Research policy: personalize planning to the AI's OWN king.
 * Inputs are own allowed cards and the opponents' visible board only.
 * Never change legal moves, draws, king abilities or turn rules.
 */
export function scoreKingPlanDeployment(card, self, enemy, difficulty="hard") {
  if(!["hard","conqueror"].includes(difficulty))return 0;
  const king=self.king?.name;
  const guards=self.field.filter(u=>u.type==="步兵").length;
  const mages=self.field.filter(u=>u.type==="法師").length;
  const attackers=self.field.filter(u=>canAttackVisible(u)).length;
  switch(king){
    case "亞歷山大大帝":
      // A reliable winning trade converts into another unit card.
      return enemy?.field?.some(u=>u.type===card.counterTarget) ? 16 :
        card.type==="騎兵" && enemy?.field?.some(u=>u.type==="步兵") ? 18 : 0;
    case "屋大維奧古斯都":
      // Keep survivable board presence to receive next opponent-turn buff.
      return card.type==="步兵" && guards===0 ? 24 :
        card.rank==="高級" && guards>0 ? 10 : 0;
    case "成吉思汗":
      // Mobility is already handled by the live recall policy; avoid crowding out guards.
      return card.type==="騎兵" && !self.field.some(u=>u.type==="騎兵") &&
        (self.recallDrawCount||0)<2 ? 6 : 0;
    case "秦始皇":
      // Protect the initial board, then convert the 9-card-capacity economy.
      return card.type==="步兵" && guards===0 ? 16 :
        self.hand.length>=6 && card.rank!=="高級" ? 18 : 0;
    case "路易十四":
      // The mage economy needs a protected setup; exposed first-turn mages are fragile.
      return card.type==="步兵" && guards===0 ? 28 :
        card.type==="法師" && mages===0 ? (guards>0?18:-6) :
        card.type==="法師" && mages>0 && attackers===0 ? 5 : 0;
    default:return 0;
  }
}

/** King-specific strategic spell timing. Adds only a modest preference to
 * the existing legality, caster-readiness and target selection checks.
 */
export function scoreKingPlanMagic({self,enemy,spell}) {
  if(!self?.king||!spell)return 0;
  const ready= self.field.filter(canAttackVisible);
  const enemyGuards=enemy?.field?.filter(u=>u.type==="步兵").length||0;
  const ownGuards=self.field.filter(u=>u.type==="步兵").length;
  switch(self.king.name){
    case "亞歷山大大帝":
      return ["火球術","流星雨","天殞術"].includes(spell.name)&&enemyGuards>0&&ready.length>0?12:0;
    case "屋大維奧古斯都":
      return spell.target==="我方" && self.field.length>=2?10:0;
    case "成吉思汗":
      return spell.name==="冰凍術" && ready.some(u=>u.type==="騎兵")?12:
        spell.name==="燃血術" && self.hp<15?-22:0;
    case "秦始皇":
      return ["火球術","流星雨","天殞術"].includes(spell.name) &&
        self.hand.length>=5 && enemyGuards>0 ? 9 : 0;
    case "路易十四":
      // First spell converts to a new unit and renews the caster's action.
      return !self.magicDrawUsed?16:
        ["火球術","流星雨"].includes(spell.name)&&enemyGuards>0?8:0;
    default:return 0;
  }
}

/** Research policy: Conqueror identifies threats in the ENEMY king's public
 * ability without guessing unrevealed cards or hidden deck order.
 */
/** Own-king battlefield priorities, distinct from generic deployment. */
export function scoreKingPlanAttack({self,enemy,attacker,defender}) {
  if(!self?.king||!enemy||!attacker)return 0;
  const prediction=defender?previewUnitAttack(attacker,defender):null;
  switch(self.king.name) {
    case "亞歷山大大帝":
      return defender && prediction?.killedEnemy ? (prediction.killedAttacker?5:22) : 0;
    case "屋大維奧古斯都":
      return defender && prediction?.killedAttacker ? -32 :
        attacker.type==="步兵" && self.field.filter(u=>u.type==="步兵").length===1 ? -24 : 0;
    case "成吉思汗":
      return attacker.type==="騎兵" && !prediction?.killedAttacker ? 12 : 0;
    case "秦始皇":
      return defender && prediction?.killedEnemy ? 14 : !defender ? 10 : 0;
    case "路易十四":
      return attacker.type==="法師" && self.field.filter(u=>u.type==="法師").length===1 ? -12 :
        defender?.type==="步兵" && prediction?.killedEnemy ? 14 : 0;
    default:return 0;
  }
}

export function counterKingThreat(enemy, self=null) {
  const king=enemy?.king?.name;
  const field=enemy?.field||[];
  const guards=field.filter(u=>u.type==="步兵").length;
  const mages=field.filter(u=>u.type==="法師").length;
  const cavalry=field.filter(u=>u.type==="騎兵").length;
  switch(king){
    case "亞歷山大大帝":
      return field.reduce((sum,u)=>sum+(canAttackVisible(u)?4:1),0);
    case "屋大維奧古斯都":
      return field.length*2+(guards?6:0);
    case "成吉思汗":
      return cavalry*7+Math.min(4,field.length)*2;
    case "秦始皇":
      return field.length<3 ? 10 : 3;
    case "路易十四":
      return mages*12+(mages && enemy.magicCount>0?Math.min(enemy.magicCount,3)*5:0);
    default:return 0;
  }
}

/** Counterplay prefers denying the visible engine, not attacking a king name
 * irrespective of its battlefield. Intended only for Conqueror research A/B.
 */
export function scoreKingCounterAttack({enemy,defender,attacker}) {
  if(!enemy||!attacker)return 0;
  if(defender){
    if(enemy.king?.name==="路易十四" && defender.type==="法師")return 28+(enemy.magicCount>0?12:0);
    if(enemy.king?.name==="成吉思汗" && defender.type==="騎兵")return 20;
    if(enemy.king?.name==="亞歷山大大帝" && canAttackVisible(defender))return 8;
    if(enemy.king?.name==="屋大維奧古斯都" && defender.type==="步兵")return 9;
    return 0;
  }
  if(enemy.king?.name==="秦始皇" && enemy.field.length<3)return 15;
  if(enemy.king?.name==="路易十四" && enemy.field.every(u=>u.type!=="步兵"))return 8;
  return 0;
}

export const AI_PROFILES = Object.freeze({
  easy: { aim: "Learn turn flow: deploy, see combat, end turn", risk: "visible", searchDepth: 0 },
  normal: { aim: "Recognize when buffs, counters and trades matter", risk: "tactical", searchDepth: 0 },
  hard: { aim: "Use tactical heuristics to protect resources and plan attacks", risk: "strategic", searchDepth: 0 },
  conqueror: { aim: "Maximize winning chances using bounded tactical continuation search", risk: "minimax-proxy", searchDepth: 2 }
});

/** Behavioral curricula affect only AI preferences, never legality, player actions or UI.
 * Easy: show normal game flow by using accessible units, without intentionally throwing.
 * Normal: recognize spell timing and retain scarce actions until they change an exchange.
 * Hard: guard resources, future threats and immediate conversion opportunities.
 */
export function scoreTeachingDeployment(card, self, enemy, difficulty, base, { louisMageSetup = false } = {}) {
  let score=base;
  const guards=self.field.filter(u=>u.type==="步兵").length;
  const mages=self.field.filter(u=>u.type==="法師").length;
  const ready= self.field.filter(u=>!u.tapped).length;
  if (difficulty==="easy") {
    if (!guards && card.type==="步兵") score+=14;
    if (card.type==="騎兵" && card.rank!=="高級") score+=9;
    if (card.rank==="高級" && self.field.length<2) score-=16;
  } else if (difficulty==="normal") {
    if (!mages && card.type==="法師" && self.magic.length) score+=20;
    // Louis XIV requires a mage on the board to begin generating magic.
    // In normal AI only, prioritize establishing that engine even with an empty magic hand.
    if (louisMageSetup && !mages && card.type==="法師" && self.king?.name==="路易十四" && !self.magic.length) score+=18;
    if (card.type==="騎兵" && enemy?.field?.some(u=>u.type==="步兵")) score+=12;
    if (card.rank==="高級" && !guards && self.hp<=15) score-=16;
  } else if (difficulty==="hard") {
    if (!guards && self.hp<18 && card.type==="步兵") score+=30;
    if (!mages && card.type==="法師" && self.magic.length>=2) score+=22;
    if (card.type==="騎兵" && enemy?.field?.some(u=>u.type==="步兵")) score+=10;
    if (card.rank==="高級" && ready===0 && self.hp<=10) score-=20;
  }
  return score;
}

export function shouldUseMagicNow({difficulty, spell, ai, enemy, value, hasReadyAlly=false}) {
  if (difficulty==="easy") return true;
  if (difficulty==="normal") {
    if (spell.name==="燃血術" && ai.hp<=12) return false;
    if (spell.target==="我方" && !hasReadyAlly && spell.name!=="燃血術") return false;
    if (spell.name==="天殞術" && enemy.field.filter(u=>u.rank!=="高級").length<2) return false;
    return value>=16;
  }
  if (spell.name==="燃血術" && ai.hp<=13) return false;
  if (spell.target==="我方" && !hasReadyAlly && spell.name!=="燃血術") return false;
  return value>=12;
}

export function selectDeployChoice(scored, difficulty, random = Math.random) {
  if (!scored.length) return null;
  if (difficulty === "easy") {
    // Low pressure, but never deliberately choose the most expensive unhelpful option.
    const reasonable = scored.filter(x => x.score >= scored[0].score - 24);
    return reasonable[Math.floor(random() * Math.min(3, reasonable.length))] || scored[0];
  }
  return scored[0];
}

/**
 * Bounded three-attack lookahead in two-player matches. It is NOT an exact game-tree solver:
 * archers, spell effects and opponent hidden hands are evaluated by the live
 * engine after selection. Models visible board trades, not a real enemy turn.
 */
function scoreTacticalMove(move, state, { battle, power, effectiveDamage, conquerorProfile = "resource" }) {
  const unit = state.own.find(x=>x.id===move.attackerId);
  const foe = state.opponents.find(x=>x.id===move.enemy.id);
  if (!unit || !canAttackVisible(unit) || !foe || foe.hp<=0) return null;
  const next = {
    own:state.own.map(x=>({...x,status:[...(x.status||[])]})),
    opponents:state.opponents.map(x=>({...x,field:x.field.map(u=>({...u,status:[...(u.status||[])]}))}))
  };
  const actor=next.own.find(x=>x.id===unit.id);
  const target=next.opponents.find(x=>x.id===foe.id);
  if (move.type==="king") {
    if (target.field.some(x=>x.type==="步兵")) return null;
    const damage=Math.min(target.hp,mitigateKingDamage(target,effectiveDamage(actor)));
    actor.tapped=true;
    target.hp-=damage;
    return { state:next,score:damage*(conquerorProfile==="assault"?34:conquerorProfile==="resource"?23:27)+(target.hp<=0?1100:0) };
  }
  const defender=target.field.find(x=>x.id===move.defenderId);
  if (!defender) return null;
  const prediction=previewUnitAttack(actor,defender);
  const {verdict,killedEnemy:killEnemy,killedAttacker:killSelf}=prediction;
  const blocked=prediction.archerSaved;
  const lastGuard=defender.type==="步兵"&&target.field.filter(x=>x.type==="步兵").length===1;
  let gain=0;
  if(killEnemy)gain+=(conquerorProfile==="resource"?45:35)+({"初級":1,"中級":2,"高級":3}[defender.rank]||1)*15
    +(lastGuard?(conquerorProfile==="assault"?60:conquerorProfile==="resource"?30:45):0)+(defender.type==="法師"&&target.magicCount>0?22:0);
  if(killSelf)gain-=(conquerorProfile==="resource"?48:34)+({"初級":1,"中級":2,"高級":3}[actor.rank]||1)*(conquerorProfile==="resource"?25:19);
  if(verdict==="defender"&&!blocked)gain-=14;
  if(killEnemy)target.field=target.field.filter(x=>x.id!==defender.id);
  if(killSelf)next.own=next.own.filter(x=>x.id!==actor.id);
  else {
    if(blocked && prediction.defenderPower>prediction.attackerPower &&
      !actor.status.includes("疲乏"))actor.status.push("疲乏");
    actor.tapped=!prediction.archerExtra;
    if(prediction.archerExtra)actor.archerBonusUsed=true;
  }
  return {state:next,score:gain};
}
function futureActions(state) {
  const actions=[];
  for(const own of state.own.filter(canAttackVisible)) {
    for(const enemy of state.opponents.filter(x=>x.hp>0)) {
      if(!enemy.field.some(x=>x.type==="步兵"))actions.push({type:"king",enemy,attackerId:own.id});
      for(const foe of enemy.field)actions.push({type:"unit",enemy,attackerId:own.id,defenderId:foe.id});
    }
  }
  return actions;
}
function chooseConquerorAttack(actions, ctx) {
  const root={own:ctx.self.field.map(u=>({...u})),
    opponents:ctx.enemies.map(p=>({...p,field:p.field.map(u=>({...u}))}))};
  const initialThreat=ctx.enemies.reduce((a,p)=>a+p.field.reduce((b,u)=>b+(u.tapped?0:ctx.effectiveDamage(u)),0),0);
  let best=null,score=-Infinity;
  for(const move of actions){
    const first=scoreTacticalMove(move,root,ctx);
    if(!first)continue;
    let branches=[{...first,score:first.score}];
    for(let depth=1;depth<3;depth++){
      const nextBranches=[];
      for(const branch of branches){
        const possible=futureActions(branch.state);
        if(!possible.length){nextBranches.push(branch);continue;}
        for(const follow of possible){
          const outcome=scoreTacticalMove(follow,branch.state,ctx);
          if(outcome)nextBranches.push({state:outcome.state,
            score:branch.score+outcome.score*(depth===1?0.9:0.75)});
        }
      }
      branches=nextBranches.sort((a,b)=>b.score-a.score).slice(0,6);
      if(!branches.length)break;
    }
    const continuation=branches.length?branches[0]:first;
    const guards=continuation.state.own.filter(u=>u.type==="步兵").length;
    const exposed=guards===0&&ctx.self.hp<=15?initialThreat*5:0;
    const counterBonus=ctx.counterKingPlan?scoreKingCounterAttack({
      enemy:move.enemy,attacker:ctx.self.field.find(u=>u.id===move.attackerId),
      defender:move.defenderId?move.enemy.field.find(u=>u.id===move.defenderId):null
    }):0;
    const ownPlanBonus=ctx.ownKingPlan?scoreKingPlanAttack({
      self:ctx.self,enemy:move.enemy,attacker:ctx.self.field.find(u=>u.id===move.attackerId),
      defender:move.defenderId?move.enemy.field.find(u=>u.id===move.defenderId):null
    }):0;
    // Conqueror's existing search remains authoritative. King preferences
    // break near-ties instead of overruling a superior tactical continuation.
    const total=continuation.score-exposed+
      Math.min(3,Math.max(-3,counterBonus))+
      Math.min(3,Math.max(-3,ownPlanBonus))+
      (ctx.researchStyle&&ctx.researchStyle!=="balanced"?
        scoreArchetypeAttack({
          style:ctx.researchStyle,self:ctx.self,enemy:move.enemy,
          attacker:ctx.self.field.find(u=>u.id===move.attackerId),
          defender:move.defenderId?move.enemy.field.find(u=>u.id===move.defenderId):null
        }) : 0);
    if(total>score){score=total;best={...move,expectedScore:total};}
  }
  return best;
}

export function selectAttackChoice(actions, { difficulty, self, enemies, random = Math.random, battle, power, canAttack, effectiveDamage, conquerorSearch = true, conquerorProfile = "balanced", counterKingPlan = false, ownKingPlan = false, researchStyle = "balanced" }) {
  if (difficulty === "conqueror" && conquerorSearch && enemies.length === 1) {
    return chooseConquerorAttack(actions,{self,enemies,battle,power,canAttack,effectiveDamage,conquerorProfile,counterKingPlan,ownKingPlan,researchStyle});
  }
  if (!actions.length) return null;
  const valued = actions.map(action => {
    const target = enemies.find(p => p.id === action.enemy.id) || action.enemy;
    const userUnit = self.field.find(u => u.id === action.attackerId);
    if (!userUnit) return { ...action, expectedScore: -Infinity };
    const defender = action.defenderId ? target.field.find(u => u.id === action.defenderId) : null;
    let score = action.score;
    if(researchStyle!=="balanced")score+=scoreArchetypeAttack({
      style:researchStyle,self,enemy:target,attacker:userUnit,defender
    });
    if (difficulty === "easy") {
      if (defender && battle(userUnit, defender) === "defender" && userUnit.type !== "弓兵") score -= 150;
      // Teaching AI favors short, visible battles instead of stopping with unused units.
      if (!defender) score += 10;
    } else if (difficulty === "normal") {
      if (defender && battle(userUnit, defender) === "defender" && userUnit.type !== "弓兵") score -= 130;
      if (defender && battle(userUnit, defender) === "both" && userUnit.rank === "高級" && defender.rank !== "高級") score -= 55;
      if (defender?.type === "步兵" && target.field.filter(u=>u.type === "步兵").length===1) score += 22;
    } else if (difficulty === "hard" || difficulty === "conqueror") {
      const result = defender ? battle(userUnit, defender) : "king";
      const lastGuard = defender?.type === "步兵" && target.field.filter(u=>u.type === "步兵").length===1;
      const otherReady = self.field.filter(u => u.id !== userUnit.id && canAttack(u));
      if (lastGuard && (result==="attacker" || result==="both" || userUnit.type==="弓兵")) {
        score += otherReady.reduce((sum,u)=>sum+effectiveDamage(u)*9,0);
      }
      if (!defender && target.hp <= effectiveDamage(userUnit)) score += 1000;
      if (userUnit.type==="步兵" && self.field.filter(u=>u.type==="步兵").length===1 && self.hp<=15 && result!=="attacker") score -= 100;
      if (defender && result==="defender" && userUnit.type!=="弓兵") score -= 140;
      if (difficulty === "conqueror") {
        // Bounded continuation: after a trade, which follow-up can actually hit?
        const defendersLeft = target.field.filter(u => u.id !== defender?.id);
        const cleared = !defender || result==="attacker" || result==="both" ||
          (userUnit.type==="弓兵" && power(defender) >= power(userUnit));
        const guardRemains = defendersLeft.some(u=>u.type==="步兵") || (!cleared && defender?.type==="步兵");
        if (!guardRemains) score += otherReady.reduce((sum,u)=>sum + effectiveDamage(u)*14,0);
        // Opponent's next-turn attack potential is a real cost even when the immediate trade looks attractive.
        const remainingSelfGuards = self.field.filter(u=>u.type==="步兵" && !(u.id===userUnit.id && result!=="attacker")).length;
        const dangerousEnemies = enemies.filter(p=>p.id!==self.id)
          .flatMap(p=>p.field).filter(canAttack);
        if (!remainingSelfGuards && self.hp<=15) {
          score -= dangerousEnemies.reduce((sum,u)=>sum+effectiveDamage(u),0)*8;
        }
        // Prefer recovering resources after winning tempo, rather than taking a pointless trade.
        if (defender && result==="both" && power(userUnit)>power(defender)) score -= 20;
      }
    }
    return {...action, expectedScore:score};
  }).sort((a,b)=>b.expectedScore-a.expectedScore);
  if (difficulty === "easy") {
    const shortlist = valued.filter(a=>a.expectedScore>=valued[0].expectedScore-30).slice(0,3);
    return shortlist[Math.floor(random()*shortlist.length)] || valued[0];
  }
  return valued[0];
}

/**
 * Mongol recall is a strategic trade-off: recover a tapped cavalry and (possibly)
 * gain a card, but expose the king and lose a board defender until redeployed.
 * This function chooses only from the AI's own public board.
 */
export function chooseMongolRecall({ self, opponents, difficulty, canAttack, maxHand, drawLimit = 2, random = Math.random }) {
  if (!self || self.king?.name !== "成吉思汗" || self.recallUsed ||
      self.hand.length >= maxHand || self.field.length < 3) return null;
  const candidates=self.field.filter(u=>u.type==="騎兵" && u.tapped);
  if (!candidates.length) return null;
  if (difficulty==="easy") return random()<0.25 ? candidates[0] : null;
  if (difficulty==="normal" && random()>0.35) return null;
  const opponentsAlive=opponents.filter(p=>!p.eliminated && p.hp>0);
  const enemyThreat=Math.max(0,...opponentsAlive.map(p=>p.field.filter(u=>canAttack(u)).length));
  const enemyGuarded=opponentsAlive.some(p=>p.field.some(u=>u.type==="步兵"));
  const drawAvailable=(self.recallDrawCount||0)<drawLimit;
  const rank={初級:1,中級:2,高級:3};
  const scored=candidates.map(unit=>{
    const boardAfter=self.field.filter(x=>x.id!==unit.id);
    let score=(drawAvailable?24:0)+(4-(rank[unit.rank]||1))*5;
    if (self.hand.length<=2) score+=9;
    if (enemyGuarded) score+=4;
    // A weak board and exposed HP make every remaining defender more valuable.
    if (boardAfter.length<2) score-=32;
    if (self.hp<=15 && enemyThreat>=2) score-=28;
    if (self.hp<=8 && enemyThreat>=1) score-=34;
    // Don't throw away an important immediate attack if it somehow remains ready.
    if (canAttack(unit)) score-=80;
    return {unit,score};
  }).sort((a,b)=>b.score-a.score);
  return scored[0]?.score>0?scored[0].unit:null;
}
