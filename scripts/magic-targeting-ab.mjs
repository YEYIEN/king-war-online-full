import assert from "node:assert/strict";
import {simulateKingBaseline} from "../server/index.js";
const seeds=[314159,271828,161803];
const perSeed=Number(process.env.MATCHES_PER_SEED||200);
const results=[];
for(const players of [3,4,5])for(const difficulty of ["normal","hard"])for(const aiMagicTargeting of [false,true]){
 const runs=[];
 for(const seed of seeds){
  const o=await simulateKingBaseline({seed,matches:perSeed,playerCount:players,
   difficulty,maxTurns:180,comebackEnabled:true,aiMagicTargeting});
  assert.deepEqual(o.invariantViolations,{});
  runs.push(o);
 }
 const sum=f=>runs.reduce((a,x)=>a+f(x),0);
 const kings=Object.fromEntries(Object.keys(runs[0].kings).map(k=>{
  const games=sum(r=>r.kings[k].games),wins=sum(r=>r.kings[k].wins);
  return [k,{games,wins,winRate:+(100*wins/games).toFixed(2)}];
 }));
 const spells={},effective={};
 for(const r of runs){
  for(const [k,v] of Object.entries(r.telemetry.spells))spells[k]=(spells[k]||0)+v;
  for(const [k,v] of Object.entries(r.telemetry.spellsEffective))effective[k]=(effective[k]||0)+v;
 }
 results.push({players,difficulty,aiMagicTargeting,games:perSeed*seeds.length,
  finished:sum(r=>r.finished),kings,
  averageTurns:+(runs.reduce((a,r)=>a+r.averageTurns,0)/runs.length).toFixed(2),
  spellUses:spells,spellObservableChanges:effective,
  kingDamage:sum(r=>r.telemetry.kingDamage),
  strictComebackWins:sum(r=>r.resultMetrics.criticalComebackWins),
  strictComebackEligible:sum(r=>r.resultMetrics.completedMatchesWithCriticalPlayer)});
 console.error("MAGIC A/B",players,difficulty,aiMagicTargeting);
}
console.log(JSON.stringify({method:"Current game rules, paired seeds for each policy (random paths may diverge after actions)",seeds,perSeed,results},null,2));
