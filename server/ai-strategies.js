/**
 * Distinct AI curricula and a bounded search-based research challenger.
 * All policies operate on public board state and the AI's own hand only.
 * Never access hidden cards belonging to an opponent.
 */
export const AI_PROFILES = Object.freeze({
  easy: { aim: "Learn turn flow: deploy, see combat, end turn", risk: "visible", searchDepth: 0 },
  normal: { aim: "Recognize when buffs, counters and trades matter", risk: "tactical", searchDepth: 0 },
  hard: { aim: "Plan a full tactical sequence and protect resources", risk: "strategic", searchDepth: 1 },
  conqueror: { aim: "Maximize winning chances using bounded tactical continuation search", risk: "minimax-proxy", searchDepth: 2 }
});

/** Behavioral curricula affect only AI preferences, never legality, player actions or UI.
 * Easy: show normal game flow by using accessible units, without intentionally throwing.
 * Normal: recognize spell timing and retain scarce actions until they change an exchange.
 * Hard: guard resources, future threats and immediate conversion opportunities.
 */
export function scoreTeachingDeployment(card, self, enemy, difficulty, base) {
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
    if (!mages && card.type==="法師" && self.king?.name==="路易十四" && !self.magic.length) score+=18;
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
 * Bounded two-action lookahead. It is NOT an exact game-tree solver:
 * archers, spell effects and opponent hidden hands are evaluated by the live
 * engine after selection. Models visible board trades and one enemy response.
 */
function scoreTacticalMove(move, state, { battle, power, effectiveDamage, conquerorProfile = "resource" }) {
  const unit = state.own.find(x=>x.id===move.attackerId);
  const foe = state.opponents.find(x=>x.id===move.enemy.id);
  if (!unit || unit.tapped || !foe || foe.hp<=0) return null;
  const next = {
    own:state.own.map(x=>({...x})),
    opponents:state.opponents.map(x=>({...x,field:x.field.map(u=>({...u}))}))
  };
  const actor=next.own.find(x=>x.id===unit.id);
  const target=next.opponents.find(x=>x.id===foe.id);
  if (move.type==="king") {
    if (target.field.some(x=>x.type==="步兵")) return null;
    const damage=Math.min(target.hp,effectiveDamage(actor));
    actor.tapped=true;
    target.hp-=damage;
    return { state:next,score:damage*(conquerorProfile==="assault"?34:conquerorProfile==="resource"?23:27)+(target.hp<=0?1100:0) };
  }
  const defender=target.field.find(x=>x.id===move.defenderId);
  if (!defender) return null;
  const verdict=battle(actor,defender);
  const blocked=actor.type==="弓兵" && power(defender)>=power(actor);
  const killEnemy=verdict==="attacker"||verdict==="both";
  const killSelf=(verdict==="defender"||verdict==="both")&&!blocked;
  const lastGuard=defender.type==="步兵"&&target.field.filter(x=>x.type==="步兵").length===1;
  let gain=0;
  if(killEnemy)gain+=(conquerorProfile==="resource"?45:35)+({"初級":1,"中級":2,"高級":3}[defender.rank]||1)*15
    +(lastGuard?(conquerorProfile==="assault"?60:conquerorProfile==="resource"?30:45):0)+(defender.type==="法師"&&target.magic?.length?22:0);
  if(killSelf)gain-=(conquerorProfile==="resource"?48:34)+({"初級":1,"中級":2,"高級":3}[actor.rank]||1)*(conquerorProfile==="resource"?25:19);
  if(verdict==="defender"&&!blocked)gain-=14;
  if(killEnemy)target.field=target.field.filter(x=>x.id!==defender.id);
  if(killSelf)next.own=next.own.filter(x=>x.id!==actor.id);
  else {
    const archerExtra=actor.type==="弓兵"&&power(defender)<power(actor)&&!actor.archerBonusUsed;
    actor.tapped=!archerExtra;
    if(archerExtra)actor.archerBonusUsed=true;
  }
  return {state:next,score:gain};
}
function futureActions(state) {
  const actions=[];
  for(const own of state.own.filter(x=>!x.tapped&&!x.status?.includes("整備"))) {
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
    const total=continuation.score-exposed;
    if(total>score){score=total;best={...move,expectedScore:total};}
  }
  return best;
}

export function selectAttackChoice(actions, { difficulty, self, enemies, random = Math.random, battle, power, canAttack, effectiveDamage, conquerorSearch = true, conquerorProfile = "balanced" }) {
  if (difficulty === "conqueror" && conquerorSearch && enemies.length === 1) {
    return chooseConquerorAttack(actions,{self,enemies,battle,power,canAttack,effectiveDamage,conquerorProfile});
  }
  if (!actions.length) return null;
  const valued = actions.map(action => {
    const target = enemies.find(p => p.id === action.enemy.id) || action.enemy;
    const userUnit = self.field.find(u => u.id === action.attackerId);
    if (!userUnit) return { ...action, expectedScore: -Infinity };
    const defender = action.defenderId ? target.field.find(u => u.id === action.defenderId) : null;
    let score = action.score;
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
