import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import {simulateKingBaseline} from "../server/index.js";
const seeds=[1379003,1689001,1908007];
const matches=Number(process.env.DUEL_REFINEMENT_MATCHES||1000);
const cases=[
 {id:"baseline",firstSeatPeacefulTurn:false,secondSeatExtraCards:0},
 {id:"primary",firstSeatPeacefulTurn:true,secondSeatExtraCards:1,firstSeatOpeningHandPenalty:1},
 {id:"extra-second-card",firstSeatPeacefulTurn:true,secondSeatExtraCards:2,firstSeatOpeningHandPenalty:1}
];
const p=(w,n)=>+(100*w/n).toFixed(2);
function ci(w,n){const z=1.96,x=w/n,d=1+z*z/n,m=(x+z*z/(2*n))/d,e=z*Math.sqrt(x*(1-x)/n+z*z/(4*n*n))/d;return [p(m-e,1),p(m+e,1)];}
const rows=[];
for(const difficulty of ["normal","hard","conqueror"])for(const candidate of cases){
 const data=[];
 for(const seed of seeds){
  const {id,...flags}=candidate;
  const r=await simulateKingBaseline({matches,seed,playerCount:2,difficulty,maxTurns:180,comebackEnabled:true,
   includeMatchRecords:true,...flags});
  assert.deepEqual(r.invariantViolations,{});
  assert.equal(r.finished+r.unfinished,matches);
  assert.equal(r.unfinishedReasons.stalledAITurn,0);
  data.push(r);
 }
 const all=data.flatMap(r=>r.matchRecords);
 const n=all.length,w=all.filter(r=>r.finished&&r.winnerSeat===1).length;
 const strata={};
 for(const game of all)for(const player of game.players){
  const key=`${player.king}:seat${player.seat}`;
  strata[key]??={games:0,wins:0};
  strata[key].games++;
  if(game.finished&&game.winnerSeat===player.seat)strata[key].wins++;
 }
 for(const value of Object.values(strata))value.winRate=p(value.wins,value.games);
 const row={difficulty,id:candidate.id,matches:n,firstWins:w,rate:p(w,n),ci95:ci(w,n),
  turns:+(data.reduce((a,r)=>a+r.averageTurns,0)/data.length).toFixed(2),
  unfinished:data.reduce((a,r)=>a+r.unfinished,0),kingSeat:strata};
 rows.push(row);
 console.error("REFINE",JSON.stringify({
  difficulty,id:candidate.id,rate:row.rate,ci95:row.ci95,turns:row.turns,unfinished:row.unfinished
 }));
}
const output={purpose:"Research-only candidate comparison, not a final holdout if alternatives are selected from these data",
 seeds,matchesPerSeed:matches,total:rows.reduce((s,r)=>s+r.matches,0),rows};
writeFileSync("duel-refinement-results.json",JSON.stringify(output,null,2));
const lines=["# Duel fairness refinement","","| AI | Rule | First win rate | 95% Wilson | Mean turns | Unfinished |","|---|---|---:|---|---:|---:|"];
for(const row of rows)lines.push(`| ${row.difficulty} | ${row.id} | ${row.rate}% | ${row.ci95.join("–")}% | ${row.turns} | ${row.unfinished} |`);
writeFileSync("duel-refinement-results.md",lines.join("\n")+"\n");
console.log(JSON.stringify({total:output.total,results:rows.map(({difficulty,id,rate,ci95,turns})=>({difficulty,id,rate,ci95,turns}))}));
