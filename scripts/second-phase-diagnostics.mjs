import assert from "node:assert/strict";
import {simulateKingBaseline} from "../server/index.js";
const seeds=[404203,558721,887503];
const matches=Number(process.env.MATCHES_PER_SEED||200);
const cases=[
 {id:"legacy",playerCount:2,difficulty:"hard",firstSeatPeacefulTurn:false,secondSeatExtraCards:0},
 {id:"first-truce-only",playerCount:2,difficulty:"hard",firstSeatPeacefulTurn:true,secondSeatExtraCards:0},
 {id:"second-extra-only",playerCount:2,difficulty:"hard",firstSeatPeacefulTurn:false,secondSeatExtraCards:1},
 {id:"combined-candidate",playerCount:2,difficulty:"hard",firstSeatPeacefulTurn:true,secondSeatExtraCards:1},
 {id:"five-hard-no-laststand",playerCount:5,difficulty:"hard",comebackEnabled:false},
 {id:"five-hard-laststand",playerCount:5,difficulty:"hard",comebackEnabled:true}
];
const output=[];
for(const scenario of cases){
 const runs=[];
 for(const seed of seeds){
  const r=await simulateKingBaseline({matches,seed,maxTurns:180,...scenario});
  assert.deepEqual(r.invariantViolations,{});
  assert.equal(r.finished+r.unfinished,matches);
  runs.push(r);
 }
 const sum=f=>runs.reduce((a,r)=>a+f(r),0);
 const firstGames=sum(r=>r.seats["1"].games),firstWins=sum(r=>r.seats["1"].wins);
 const eligible=sum(r=>r.resultMetrics.completedMatchesWithCriticalPlayer);
 const crisisWins=sum(r=>r.resultMetrics.criticalComebackWins);
 const assaultUses=sum(r=>r.comebackUse?.assault||0);
 const defenseUses=sum(r=>r.comebackUse?.defense||0);
 output.push({id:scenario.id,games:matches*seeds.length,finished:sum(r=>r.finished),
  firstSeat:{games:firstGames,wins:firstWins,winRate:firstGames?+(100*firstWins/firstGames).toFixed(2):null},
  critical:{eligible,wins:crisisWins,winRate:eligible?+(100*crisisWins/eligible).toFixed(2):null},
  lastStand:{assaultUses,defenseUses},
  averageTurns:+(runs.reduce((a,r)=>a+r.averageTurns,0)/runs.length).toFixed(2)});
}
console.log(JSON.stringify({kind:"research-only",seeds,matchesPerSeed:matches,output},null,2));
