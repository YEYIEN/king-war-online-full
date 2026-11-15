import assert from "node:assert/strict";
import {simulateKingBaseline} from "../server/index.js";
const seeds=[141421,173205,223607];
const matches=Number(process.env.MATCHES_PER_SEED||200);
const candidates=[
  {id:"normal-control",settings:{louisMageSetup:false}},
  {id:"normal-louis-mage-setup",settings:{louisMageSetup:true}}
];
const out=[];
for(const candidate of candidates){
 const runs=[];
 for(const seed of seeds){
  const run=await simulateKingBaseline({matches,seed,playerCount:4,difficulty:"normal",maxTurns:180,comebackEnabled:true,...candidate.settings});
  assert.deepEqual(run.invariantViolations,{});
  assert.equal(run.finished+run.unfinished,matches);
  runs.push(run);
 }
 const sum=f=>runs.reduce((s,r)=>s+f(r),0);
 const kingName="路易十四";
 const games=sum(r=>r.kings[kingName].games),wins=sum(r=>r.kings[kingName].wins);
 const eligible=sum(r=>r.resultMetrics.completedMatchesWithCriticalPlayer);
 const comebackWins=sum(r=>r.resultMetrics.criticalComebackWins);
 out.push({id:candidate.id,matches:matches*seeds.length,completed:sum(r=>r.finished),louis:{games,wins,winRate:games?+(100*wins/games).toFixed(2):null},criticalComeback:{eligible,wins:comebackWins,rate:eligible?+(100*comebackWins/eligible).toFixed(2):null},meanTurns:+(runs.reduce((s,r)=>s+r.averageTurns,0)/runs.length).toFixed(2)});
}
console.log(JSON.stringify({kind:"experimental-only",seeds,matchesPerSeed:matches,out},null,2));
