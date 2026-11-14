import {canAttack, effectiveDamage, power, rankValue} from "./combat-primitives.js";
import {listPublicAttackCandidates} from "./ai-legal-actions.js";
import {applyPublicAttackStep} from "./public-combat-replay.js";

/**
 * Imperfect-information, bounded tactical lookahead.
 *
 * Everyone is modelled as maximizing their own first-place prospects:
 * opponents do not cooperate and do not know unrevealed cards.
 * This is deliberately NOT exhaustive full-game solving. It evaluates legal
 * visible-board attacks and plausible next-turn retaliation, without inventing
 * hands, draws, spells or exact future passive triggers.
 */
export const RATIONAL_SEARCH_DEFAULTS = Object.freeze({
  ownDepth: 3,
  rootWidth: 11,
  beamWidth: 4,
  responseDepth: 1,
  maxNodes: 1600,
  responseWidth: 20
});

const strip=(player)=>({
  id:player.id,hp:player.hp,eliminated:!!player.eliminated,
  lastStandShield:player.lastStandShield||0,
  field:(player.field||[]).map(u=>({
    id:u.id,type:u.type,rank:u.rank,damage:u.damage,counterTarget:u.counterTarget,
    status:[...(u.status||[])],tapped:!!u.tapped,archerBonusUsed:!!u.archerBonusUsed
  }))
});

function participants(state) {return [state.own,...state.opponents];}
function boardValue(player){
  const field=player.field||[];
  let value=0;
  for(const unit of field){
    value+=13+rankValue(unit.rank)*8+effectiveDamage(unit)*2.2;
    if(unit.type==="步兵")value+=7;
    if(unit.type==="法師")value+=5;
    if(canAttack(unit))value+=4;
    if(unit.status.includes("疲乏"))value-=4;
  }
  return value;
}
function kingEngine(player,meta){
  const king=meta[player.id]?.king?.name;
  const field=player.field||[];
  if(king==="亞歷山大大帝")return field.filter(canAttack).length*3;
  if(king==="屋大維奧古斯都")return field.length*4;
  if(king==="成吉思汗")return field.filter(u=>u.type==="騎兵").length*5;
  if(king==="秦始皇")return 8;
  if(king==="路易十四")return field.filter(u=>u.type==="法師").length*11+
    Math.min(3,meta[player.id]?.magicCount||0)*3;
  return 0;
}
/** Bounded heuristic utility, not calibrated true win probability. */
export function firstPlaceUtility(state,heroId,meta={}){
  const players=participants(state),me=players.find(p=>p.id===heroId);
  if(!me||me.eliminated||me.hp<=0)return -100000;
  const living=players.filter(p=>!p.eliminated&&p.hp>0);
  if(living.length===1)return 100000;
  const others=players.filter(p=>p.id!==heroId);
  const own=me.hp*9+boardValue(me)+kingEngine(me,meta);
  const threat=others.reduce((sum,p)=>sum+(p.eliminated||p.hp<=0?0:
    (p.hp*9+boardValue(p)+kingEngine(p,meta))),0);
  const defeated=others.filter(p=>p.eliminated||p.hp<=0).length;
  // An elimination helps, but other rivals continue to matter in FFA games.
  return own-threat/Math.max(1,others.length)*0.48+defeated*220;
}
function asMove(a){return {
  type:a.type,enemyId:a.enemyId||a.enemy?.id,attackerId:a.attackerId,
  ...(a.defenderId?{defenderId:a.defenderId}:{})
};}
function actionsFor(state){return listPublicAttackCandidates(state.own.field,state.opponents);}
function transition(state,action,counters){
  if(counters.nodes>=counters.maxNodes)return null;
  counters.nodes++;
  const outcome=applyPublicAttackStep(state,asMove(action));
  return outcome.ok?outcome.state:null;
}
/** Project the next enemy turn with currently revealed units only.
 * Start-of-turn untaps are known, while unknown draws and spells are omitted.
 */
function readyOnNextTurn(unit){
  return {
    ...unit,tapped:false,archerBonusUsed:false,
    status:[...(unit.status||[])].filter(s=>
      !["整備","階級+1","階級-1","傷害+1","燃血+1傷害","急援"].includes(s))
  };
}
function opponentResponse(state,heroId,meta,counters,opts){
  let worst={state,utility:firstPlaceUtility(state,heroId,meta),enemyId:null};
  const current=participants(state);
  const initial=worst.utility;
  for(const adversary of current){
    if(adversary.id===heroId||adversary.eliminated||adversary.hp<=0)continue;
    const reply={
      own:{...strip(adversary),field:adversary.field.map(readyOnNextTurn)},
      opponents:current.filter(p=>p.id!==adversary.id).map(strip)
    };
    const choices=actionsFor(reply);
    const before=firstPlaceUtility(reply,adversary.id,meta);
    let bestOwnGain=0,bestHeroState=null;
    // A rational opponent considers all visible legal attack candidates,
    // not just the first target in a loop. The total workload remains capped.
    // Preserve an explicit no-attack option when every trade is disadvantageous.
    const replyCandidates=[];
    for(const action of choices){
      if(counters.nodes>=counters.maxNodes)break;
      const after=transition(reply,action,counters);
      if(!after)continue;
      const gain=firstPlaceUtility(after,adversary.id,meta)-before;
      replyCandidates.push({gain,after});
    }
    replyCandidates.sort((a,b)=>b.gain-a.gain);
    for(const candidate of replyCandidates.slice(0,opts.responseWidth)){
      if(candidate.gain>bestOwnGain){
        bestOwnGain=candidate.gain;
        bestHeroState=candidate.after;
      }
    }
    if(!bestHeroState)continue;
    const resultPlayers=participants(bestHeroState);
    const reconstructed={
      own:strip(resultPlayers.find(p=>p.id===heroId)),
      opponents:resultPlayers.filter(p=>p.id!==heroId).map(strip)
    };
    const utility=firstPlaceUtility(reconstructed,heroId,meta);
    // Worst individually-rational response; do not assume all rivals coordinate.
    if(utility<worst.utility)worst={state:reconstructed,utility,enemyId:adversary.id};
  }
  return {utility:worst.utility,loss:Math.max(0,initial-worst.utility),enemyId:worst.enemyId};
}
function capped(value,min,max){return Math.min(max,Math.max(min,value));}

/** Returns an existing live action with expectedScore, or null if passing is
 * better. All path exploration uses detached public snapshots.
 */
export function chooseRationalAttack(actions,{self,enemies,...settings}={}){
  if(!self||!Array.isArray(actions)||!actions.length||!Array.isArray(enemies))return null;
  const opts={
    ownDepth:capped(Math.trunc(settings.ownDepth||3),1,4),
    rootWidth:capped(Math.trunc(settings.rootWidth||11),1,24),
    beamWidth:capped(Math.trunc(settings.beamWidth||4),1,8),
    maxNodes:capped(Math.trunc(settings.maxNodes||1600),60,5000),
    responseWidth:capped(Math.trunc(settings.responseWidth||20),1,60)
  };
  const meta=Object.fromEntries([self,...enemies].map(p=>[p.id,{
    king:p.king,magicCount:p.magicCount??p.magic?.length??0
  }]));
  const initial={own:strip(self),opponents:enemies.map(strip)};
  const counter={nodes:0,maxNodes:opts.maxNodes};
  const baseline=firstPlaceUtility(initial,self.id,meta);
  const roots=[];
  for(const raw of actions){
    const next=transition(initial,raw,counter);
    if(!next)break;
    const delta=firstPlaceUtility(next,self.id,meta)-baseline;
    roots.push({raw,state:next,delta,first:raw,depth:1});
  }
  roots.sort((a,b)=>b.delta-a.delta);
  const shortlist=roots.slice(0,opts.rootWidth);
  if(!shortlist.length)return null;
  let winning=null,bestValue=-Infinity;
  const baselineRetaliation=opponentResponse(initial,self.id,meta,counter,opts);
  const passScore=baseline-0.68*baselineRetaliation.loss;
  for(const root of shortlist){
    if(counter.nodes>=counter.maxNodes)break;
    let beam=[root],evaluated=[root];
    for(let d=1;d<opts.ownDepth;d++){
      let nextBeam=[];
      for(const branch of beam){
        if(counter.nodes>=counter.maxNodes)break;
        for(const action of actionsFor(branch.state)){
          const next=transition(branch.state,action,counter);
          if(!next)break;
          nextBeam.push({...branch,state:next,
            delta:firstPlaceUtility(next,self.id,meta)-baseline,depth:d+1});
        }
      }
      nextBeam.sort((a,b)=>b.delta-a.delta);
      beam=nextBeam.slice(0,opts.beamWidth);
      if(!beam.length)break;
      evaluated.push(...beam);
    }
    for(const item of evaluated){
      if(counter.nodes>=counter.maxNodes)break;
      const response=opponentResponse(item.state,self.id,meta,counter,opts);
      // The longest forecast is worth less: future actions may be invalidated
      // by unknown draws or hidden magic.
      const horizonPenalty=(item.depth-1)*2.5;
      const estimate=baseline+item.delta-response.loss*0.68-horizonPenalty;
      if(estimate>bestValue){
        bestValue=estimate;winning=root.raw;
      }
    }
  }
  if(!winning||bestValue<=passScore+1)return null;
  return {...winning,expectedScore:Math.max(6,Math.round(bestValue-passScore+8)),
    rationalNodes:counter.nodes};
}
