import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import {simulateKingBaseline} from "../server/index.js";
const matches=Number(process.env.DUEL_CALIBRATION_MATCHES||250);
const seeds=[429503,533017,644029];
const cases=[
 {id:"control",firstSeatPeacefulTurn:false,secondSeatExtraCards:0},
 {id:"peace-card1",firstSeatPeacefulTurn:true,secondSeatExtraCards:1},
 {id:"peace-card1-hand1",firstSeatPeacefulTurn:true,secondSeatExtraCards:1,firstSeatOpeningHandPenalty:1},
 {id:"peace-card1-hand2",firstSeatPeacefulTurn:true,secondSeatExtraCards:1,firstSeatOpeningHandPenalty:2},
 {id:"peace-card1-draw1",firstSeatPeacefulTurn:true,secondSeatExtraCards:1,firstSeatInitialDrawPenalty:1},
 {id:"peace-card1-deploy2",firstSeatPeacefulTurn:true,secondSeatExtraCards:1,firstSeatInitialDeployLimit:2},
 {id:"peace-card1-deploy1",firstSeatPeacefulTurn:true,secondSeatExtraCards:1,firstSeatInitialDeployLimit:1},
 {id:"peace-card1-hand1-deploy2",firstSeatPeacefulTurn:true,secondSeatExtraCards:1,firstSeatOpeningHandPenalty:1,firstSeatInitialDeployLimit:2},
 {id:"peace-card1-draw1-deploy2",firstSeatPeacefulTurn:true,secondSeatExtraCards:1,firstSeatInitialDrawPenalty:1,firstSeatInitialDeployLimit:2},
 {id:"peace-card2-hand1",firstSeatPeacefulTurn:true,secondSeatExtraCards:2,firstSeatOpeningHandPenalty:1},
 {id:"peace-card2-draw1",firstSeatPeacefulTurn:true,secondSeatExtraCards:2,firstSeatInitialDrawPenalty:1},
 {id:"peace-card2-deploy2",firstSeatPeacefulTurn:true,secondSeatExtraCards:2,firstSeatInitialDeployLimit:2}
];
const ratio=(w,n)=>+(100*w/n).toFixed(2);
const ci=(w,n)=>{const z=1.96,p=w/n,den=1+z*z/n,center=(p+z*z/(2*n))/den,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;return [ratio(center-h,1),ratio(center+h,1)];};
const rows=[];
for(const difficulty of ["hard","conqueror"])for(const c of cases){
 const runs=[];
 for(const seed of seeds){
  const {id,...settings}=c;
  const r=await simulateKingBaseline({matches,seed,maxTurns:180,playerCount:2,difficulty,comebackEnabled:true,includeMatchRecords:true,...settings});
  assert.deepEqual(r.invariantViolations,{});
  assert.equal(r.finished+r.unfinished,matches);
  assert.equal(r.unfinishedReasons.stalledAITurn,0);
  runs.push(r);
 }
 const total=runs.reduce((a,r)=>a+r.seats["1"].games,0),wins=runs.reduce((a,r)=>a+r.seats["1"].wins,0);
 const seatKing={};
 const initialHand={};
 for(const r of runs)for(const game of r.matchRecords){
  for(const player of game.players){
   const key=`${player.king}/seat${player.seat}`;
   seatKing[key]??={games:0,wins:0};
   seatKing[key].games++;
   if(game.finished && game.winnerSeat===player.seat)seatKing[key].wins++;
   if(player.seat===1){
    initialHand[player.startingUnits]??=0;
    initialHand[player.startingUnits]++;
   }
  }
 }
 for(const obj of Object.values(seatKing))obj.winRate=ratio(obj.wins,obj.games);
 const rec={
  difficulty,id:c.id,settings:c,matches:total,wins,firstSeatRate:ratio(wins,total),ci95:ci(wins,total),
  avgTurns:+(runs.reduce((a,r)=>a+r.averageTurns,0)/runs.length).toFixed(2),
  unfinished:runs.reduce((a,r)=>a+r.unfinished,0),
  criticalWins:runs.reduce((a,r)=>a+r.resultMetrics.criticalComebackWins,0),
  kingSeat:seatKing,firstSeatStartingHandDistribution:initialHand
 };
 rows.push(rec);
 console.error("CALIBRATION",JSON.stringify({
  difficulty,id:c.id,firstSeatRate:rec.firstSeatRate,ci95:rec.ci95,
  avgTurns:rec.avgTurns,unfinished:rec.unfinished
 }));
}
const summary={schema:1,seeds,matchesPerSeed:matches,methods:"AI-vs-AI headless server rules; research-only first-seat compensations",
 totalGames:rows.reduce((a,r)=>a+r.matches,0),
 constraints:["Exploration, not adoption","King-seat strata require holdout","Do not tune by exact sample equality to 50%"],rows};
writeFileSync("duel-calibration-raw.json",JSON.stringify(summary,null,2));
const md=["# Duel opening calibration, second exploratory round","","| AI | Plan | First-seat wins | 95% interval | Turns | Unfinished |","|---|---|---:|---|---:|---:|"];
for(const row of rows)md.push(`| ${row.difficulty} | ${row.id} | ${row.firstSeatRate}% | ${row.ci95[0]}–${row.ci95[1]}% | ${row.avgTurns} | ${row.unfinished} |`);
writeFileSync("duel-calibration-summary.md",md.join("\n")+"\n");
console.log(JSON.stringify({totalGames:summary.totalGames,rows:rows.map(({difficulty,id,firstSeatRate,ci95,avgTurns,unfinished})=>({difficulty,id,firstSeatRate,ci95,avgTurns,unfinished}))},null,2));
