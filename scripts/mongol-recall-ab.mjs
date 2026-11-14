import assert from "node:assert/strict";
import { simulateKingBaseline } from "../server/index.js";

const seeds=[104729,130363,196613];
const matches=Number(process.env.MATCHES_PER_SEED || 300);
const results=[];
for(const players of [2,3,4,5])for(const difficulty of ["normal","hard","conqueror"])for(const updated of [false,true]){
 const runs=[];
 for(const seed of seeds){
  const r=await simulateKingBaseline({seed,matches,playerCount:players,difficulty,
    aiRecallStrategy:updated,maxTurns:180,comebackEnabled:true});
  assert.deepEqual(r.invariantViolations,{});
  runs.push(r);
 }
 const sum=f=>runs.reduce((a,r)=>a+f(r),0);
 const finished=sum(r=>r.finished),games=matches*seeds.length;
 const king="成吉思汗";
 const played=sum(r=>r.kings[king].games),won=sum(r=>r.kings[king].wins);
 results.push({players,difficulty,updated,games,finished,meanTurns:+(sum(r=>r.averageTurns)/runs.length).toFixed(2),
  mongol:{games:played,wins:won,winRate:+(100*won/played).toFixed(2)},
  recalls:sum(r=>r.telemetry.mongolRecalls),
  allKingWins:Object.fromEntries(Object.keys(runs[0].kings).map(k=>[k,sum(r=>r.kings[k].wins)])),
  firstSeatWins:sum(r=>r.seats["1"].wins)});
 console.error("recall",players,difficulty,updated,"win",won,"/",played);
}
console.log(JSON.stringify({description:"Mongol AI recall strategy A/B with identical initial seeds; full legal engine and no player rule changes",seeds,matches,results},null,2));
