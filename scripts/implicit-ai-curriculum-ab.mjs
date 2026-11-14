import assert from "node:assert/strict";
import { simulateKingBaseline } from "../server/index.js";

const seeds=[104729,130363,196613];
const count=Number(process.env.MATCHES_PER_SEED || 250);
const scenarios=[];
for(const players of [2,5]) for(const difficulty of ["easy","normal","hard"]) for(const updated of [false,true]) {
 const runs=[];
 for(const seed of seeds){
  const r=await simulateKingBaseline({playerCount:players,difficulty,seed,matches:count,
    aiCurriculumPolicy:updated,comebackEnabled:true,maxTurns:180});
  assert.deepEqual(r.invariantViolations,{},`state corruption ${players} ${difficulty} ${updated}`);
  runs.push(r);
 }
 const sum=f=>runs.reduce((a,r)=>a+f(r),0);
 const finished=sum(r=>r.finished),games=seeds.length*count;
 scenarios.push({players,difficulty,updated,games,finished,unfinished:games-finished,
  averageTurns:+(sum(r=>r.averageTurns)/runs.length).toFixed(2),
  kings:Object.fromEntries(Object.keys(runs[0].kings).map(name=>{
    const played=sum(r=>r.kings[name].games),wins=sum(r=>r.kings[name].wins);
    return [name,{played,wins,rate: +(100*wins/played).toFixed(2)}];
  })),
  firstSeatWinRate: +(100*sum(r=>r.seats["1"].wins)/sum(r=>r.seats["1"].games)).toFixed(2),
  spells:sum(r=>Object.values(r.telemetry.spells).reduce((a,b)=>a+b,0)),
  unitAttacks:sum(r=>r.telemetry.unitAttacks),
  kingDamage:sum(r=>r.telemetry.kingDamage)
 });
 console.error("A/B",players,difficulty,updated,"finished",finished,"/",games);
}
console.log(JSON.stringify({methodology:"Normal game rules unchanged; only internal AI deployment preference and magic timing toggled. Each configuration uses three identical initial seeds, 750 games.",seeds,count,scenarios},null,2));
