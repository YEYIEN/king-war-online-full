import { canAttack, effectiveDamage, previewUnitAttack } from "./combat-primitives.js";
import { mitigateKingDamage } from "./comeback-rules.js";

/**
 * Isolated public-board attack transition for deterministic analysis.
 * This is NOT a full game simulation: card draws, turn order, magical effects,
 * and king passives need the authoritative game engine.
 * Never inject hidden hands or decks into these snapshots.
 */
export function applyPublicAttackStep(snapshot, action) {
  if (!snapshot || !snapshot.own || !Array.isArray(snapshot.opponents) || !action)
    return {ok:false,error:"invalid snapshot",state:snapshot};
  const {type,attackerId,enemyId,defenderId}=action;
  if(type!=="king" && type!=="unit")
    return {ok:false,error:"unknown attack type",state:snapshot};
  const originalEnemy=snapshot.opponents.find(player=>player.id===enemyId && !player.eliminated && player.hp>0);
  const originalAttacker=snapshot.own.field?.find(unit=>unit.id===attackerId);
  if(!originalEnemy || !originalAttacker || !canAttack(originalAttacker))
    return {ok:false,error:"illegal attacker or target",state:snapshot};
  if(type==="king" && originalEnemy.field.some(unit=>unit.type==="步兵"))
    return {ok:false,error:"infantry guard protects king",state:snapshot};
  if(type==="unit" && !originalEnemy.field.some(unit=>unit.id===defenderId))
    return {ok:false,error:"missing defender",state:snapshot};

  const cloneUnit=unit=>({...unit,status:[...(unit.status||[])]});
  const state={
    own:{...snapshot.own,field:snapshot.own.field.map(cloneUnit)},
    opponents:snapshot.opponents.map(player=>({
      ...player, field:player.field.map(cloneUnit)
    }))
  };
  const attacker=state.own.field.find(unit=>unit.id===attackerId);
  const enemy=state.opponents.find(player=>player.id===enemyId);
  if(type==="king"){
    // The shield is copied and consumed only on the forecast state.
    const damage=mitigateKingDamage(enemy,effectiveDamage(attacker));
    enemy.hp-=damage;
    if(enemy.hp<=0)enemy.eliminated=true;
    attacker.tapped=true;
    return {ok:true,state,event:{type:"king",enemyId,attackerId,damage,eliminated:!!enemy.eliminated}};
  }
  const defender=enemy.field.find(unit=>unit.id===defenderId);
  const prediction=previewUnitAttack(attacker,defender);
  attacker.tapped=true;
  if(prediction.archerSaved && prediction.defenderPower>prediction.attackerPower &&
      !attacker.status.includes("疲乏"))attacker.status.push("疲乏");
  if(prediction.killedEnemy)
    enemy.field=enemy.field.filter(unit=>unit.id!==defenderId);
  if(prediction.killedAttacker)
    state.own.field=state.own.field.filter(unit=>unit.id!==attackerId);
  const survivor=state.own.field.find(unit=>unit.id===attackerId);
  if(survivor && prediction.archerExtra){
    survivor.tapped=false;
    survivor.archerBonusUsed=true;
  }
  return {ok:true,state,event:{
    type:"unit",enemyId,attackerId,defenderId,
    verdict:prediction.verdict,killedEnemy:prediction.killedEnemy,
    killedAttacker:prediction.killedAttacker,archerExtra:prediction.archerExtra,
    archerSaved:prediction.archerSaved
  }};
}

export function replayPublicAttackSteps(initial, actions) {
  if(!Array.isArray(actions))return {ok:false,error:"actions must be an array",state:initial,events:[]};
  let state=initial;
  const events=[];
  for(let i=0;i<actions.length;i++){
    const outcome=applyPublicAttackStep(state,actions[i]);
    if(!outcome.ok)return {...outcome,failedAt:i,events};
    state=outcome.state;
    events.push(outcome.event);
  }
  return {ok:true,state,events};
}
