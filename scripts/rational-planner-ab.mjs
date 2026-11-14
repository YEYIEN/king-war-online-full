import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import {performance} from "node:perf_hooks";
import {simulateKingBaseline} from "../server/index.js";

const seeds=[831913,931927,1049137];
const games=Number(process.env.RATIONAL_GAMES_PER_SEED||12);
const scenarios=[];
for(const playerCount of [2,3,4,5])for(const arm of [
 {name:"conqueror-control",ownPlan:false,counter:false,rational:false},
 {name:"conqueror-rational",ownPlan:false,counter:false,rational:true},
 {name:"conqueror-rational-plus-own",ownPlan:true,counter:false,rational:true}
])scenarios.push({playerCount,...arm});
const pc=(w,n)=>n?+(w/n*100).toFixed(2):null;
const reports=[];
for(const scenario of scenarios){
 const results=[];
 for(const seed of seeds){
  const before=performance.now();
  const r=await simulateKingBaseline({
   playerCount:scenario.playerCount,difficulty:"conqueror",challenger:"conqueror",
   challengerRationalSearch:scenario.rational,
   challengerKingPlan:scenario.ownPlan,
   challengerCounterPlan:scenario.counter,
   seed,matches:games,maxTurns:180,comebackEnabled:true
  });
  assert.deepEqual(r.invariantViolations,{},`invariants: ${scenario.name}/${scenario.playerCount}/${seed}`);
  assert.equal(r.finished+r.unfinished,games);
  assert.equal(r.unfinishedReasons.stalledAITurn,0,`AI stalled: ${scenario.name}/${seed}`);
  results.push({r,ms:performance.now()-before,seed});
 }
 const sum=fn=>results.reduce((v,x)=>v+fn(x.r),0),wins=sum(r=>r.challengerStats.wins),n=sum(r=>r.challengerStats.matches);
 const kingStats={};
 for(const name of Object.keys(results[0].r.challengerStats.gamesByKing)){
  const count=sum(r=>r.challengerStats.gamesByKing[name]||0);
  const w=sum(r=>r.challengerStats.winsByKing[name]||0);
  kingStats[name]={count,wins:w,rate:pc(w,count)};
 }
 const seatStats={};
 for(const seat of Object.keys(results[0].r.challengerStats.gamesBySeat)){
  const count=sum(r=>r.challengerStats.gamesBySeat[seat]||0),w=sum(r=>r.challengerStats.winsBySeat[seat]||0);
  seatStats[seat]={count,wins:w,rate:pc(w,count)};
 }
 const row={
  playerCount:scenario.playerCount,arm:scenario.name,games:n,wins,rate:pc(wins,n),
  finished:sum(r=>r.finished),unfinished:sum(r=>r.unfinished),
  meanSimulationMsPerGame:+(results.reduce((t,x)=>t+x.ms,0)/n).toFixed(2),
  seedElapsedMs:results.map(x=>({seed:x.seed,elapsed:+x.ms.toFixed(2)})),
  kingStats,seatStats
 };
 reports.push(row);
 console.error("RATIONAL_AB",JSON.stringify({players:row.playerCount,arm:row.arm,n:row.games,wins:row.wins,rate:row.rate,msPerGame:row.meanSimulationMsPerGame}));
}
const out={
 purpose:"Conqueror rational rollout feasibility and win-rate regression screening; no balance changes",
 status:"exploratory",seedSet:seeds,gamesPerSeed:games,totalGames:reports.reduce((n,r)=>n+r.games,0),
 caveats:[
  "Only opponent visible-board attack replies are simulated, with turn-ready assumption; hidden cards, spells and passive triggers are unmodelled.",
  "The value function is an ordinal first-place proxy, NOT a calibrated probability of victory.",
  "Wall time includes simulated match overhead; not individual p95 decision latency.",
  "One challenger gets policy; all rivals remain baseline conqueror."
 ],reports
};
writeFileSync("rational-planner-ab.json",JSON.stringify(out,null,2));
console.log(JSON.stringify({scenarios:reports.length,totalGames:out.totalGames,summary:reports.map(r=>({players:r.playerCount,arm:r.arm,rate:r.rate,wins:r.wins,games:r.games,msPerGame:r.meanSimulationMsPerGame}))},null,2));
