import assert from "node:assert/strict";
import { simulateKingBaseline } from "../server/index.js";
const seeds=[104729,130363,196613],matches=Number(process.env.MATCHES_PER_SEED||500);
const results=[];
for(const players of [2,3,4,5])for(const defenseRallyEnabled of [false,true]){
 const runs=[];
 for(const seed of seeds){
  const r=await simulateKingBaseline({matches,seed,playerCount:players,difficulty:"hard",
    maxTurns:180,comebackPolicy:"legacy",comebackEnabled:true,defenseRallyEnabled});
  assert.deepEqual(r.invariantViolations,{});
  assert.equal(r.finished+r.unfinished,matches);
  runs.push(r);
 }
 const sum=f=>runs.reduce((a,r)=>a+f(r),0);
 const crisis=sum(r=>r.resultMetrics.completedMatchesWithCriticalPlayer),wins=sum(r=>r.resultMetrics.criticalComebackWins);
 const severe=sum(r=>r.resultMetrics.completedMatchesWithTrailingPlayer),severeWins=sum(r=>r.resultMetrics.actualComebackWins);
 results.push({players,defenseRallyEnabled,games:matches*seeds.length,finished:sum(r=>r.finished),
  meanTurns:+(sum(r=>r.averageTurns)/runs.length).toFixed(2),
  lastStandDefenseUses:sum(r=>r.comebackUse.defense),
  criticalQualifiedGames:crisis,criticalWins:wins,
  criticalRecoveryRate:crisis?+(100*wins/crisis).toFixed(2):0,
  broadQualifiedGames:severe,broadWins:severeWins,
  broadRecoveryRate:severe?+(100*severeWins/severe).toFixed(2):0});
}
console.log(JSON.stringify({seeds,matchesPerSeed:matches,results},null,2));
