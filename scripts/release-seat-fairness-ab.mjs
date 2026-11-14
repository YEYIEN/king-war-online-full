import {simulateKingBaseline} from "../server/index.js";
import assert from "node:assert/strict";
const seeds=[314159,271828,161803];
const perSeed=Number(process.env.SEAT_MATCHES_PER_SEED||300);
const variants=[
 {id:"current",firstSeatPeacefulTurn:false,secondSeatExtraCards:0},
 {id:"peace-only",firstSeatPeacefulTurn:true,secondSeatExtraCards:0},
 {id:"second-card",firstSeatPeacefulTurn:false,secondSeatExtraCards:1},
 {id:"peace-plus-card",firstSeatPeacefulTurn:true,secondSeatExtraCards:1},
 {id:"two-cards",firstSeatPeacefulTurn:false,secondSeatExtraCards:2},
 {id:"peace-plus-two-cards",firstSeatPeacefulTurn:true,secondSeatExtraCards:2}
];
const rows=[];
for(const difficulty of ["normal","hard","conqueror"])for(const variant of variants){
 const runs=[];
 for(const seed of seeds){
  const r=await simulateKingBaseline({matches:perSeed,playerCount:2,difficulty,seed,maxTurns:180,
    comebackEnabled:true,firstSeatPeacefulTurn:variant.firstSeatPeacefulTurn,
    secondSeatExtraCards:variant.secondSeatExtraCards});
  assert.deepEqual(r.invariantViolations,{});
  runs.push(r);
 }
 const sum=f=>runs.reduce((s,r)=>s+f(r),0);
 const total=perSeed*seeds.length;
 const first=sum(r=>r.seats["1"].wins),second=sum(r=>r.seats["2"].wins);
 const kings={};
 for(const king of Object.keys(runs[0].kings)){
  const games=sum(r=>r.kings[king].games),wins=sum(r=>r.kings[king].wins);
  kings[king]={games,wins,rate:+(100*wins/games).toFixed(2)};
 }
 rows.push({difficulty,variant:variant.id,config:variant,games:total,finished:sum(r=>r.finished),
  firstSeatRate:+(100*first/total).toFixed(2),secondSeatRate:+(100*second/total).toFixed(2),
  meanActionTurns:+(sum(r=>r.averageTurns)/runs.length).toFixed(2),kings});
 console.error(difficulty,variant.id,first,"/",total);
}
console.log(JSON.stringify({research:"Simulated normal rules, no forced player behavior; seat fairness strategies are experimental until approved for production.",seeds,perSeed,rows},null,2));
