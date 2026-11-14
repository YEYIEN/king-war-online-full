/**
 * Enumerate public-board attack choices without accessing player hands, decks,
 * sockets or reconnect tokens. The authoritative resolver still validates each
 * selected action at execution time.
 */
export function listPublicAttackCandidates(ownUnits, opponents, {truce=false}={}) {
  if(truce) return [];
  const result=[];
  for(const attacker of ownUnits) {
    if(!canAttack(attacker)) continue;
    for(const opponent of opponents) {
      if(opponent.eliminated || opponent.hp<=0) continue;
      if(!opponent.field.some(unit=>unit.type==="步兵")) {
        result.push({type:"king",enemyId:opponent.id,attackerId:attacker.id});
      }
      for(const defender of opponent.field) {
        result.push({type:"unit",enemyId:opponent.id,attackerId:attacker.id,defenderId:defender.id});
      }
    }
  }
  return result;
}
