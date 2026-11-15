import assert from "node:assert/strict";
import { simulateKingBaseline } from "../server/index.js";

const seeds=[104729,130363,196613];
const matches=Number(process.env.MATCHES_PER_SEED||200);
// Treat bot skill only as a measurable PROXY, not as proof of human mastery.
const exams=[
  {stage:"easy",trainee:"easy"},
  {stage:"easy",trainee:"normal"},
  {stage:"normal",trainee:"easy"},
  {stage:"normal",trainee:"normal"},
  {stage:"normal",trainee:"hard"},
  {stage:"hard",trainee:"normal"},
  {stage:"hard",trainee:"hard"},
  {stage:"conqueror",trainee:"hard"}
];
const results=[];
for(const {stage,trainee} of exams) {
 const games=[];
 for(const seed of seeds) {
  const outcome=await simulateKingBaseline({playerCount:2,matches,seed,difficulty:stage,
    challenger:trainee,maxTurns:180,comebackEnabled:true});
  assert.deepEqual(outcome.invariantViolations,{});
  games.push(outcome);
 }
 const sum=f=>games.reduce((a,g)=>a+f(g),0);
 const wins=sum(g=>g.challengerStats.wins),total=games.length*matches;
 results.push({stage,trainee,traineeWinRate:+(100*wins/total).toFixed(2),
  opponentWinRate:+(100*(total-wins-sum(g=>g.challengerStats.unfinished))/total).toFixed(2),
  winCounts:[wins,total],unfinished:sum(g=>g.challengerStats.unfinished),
  bySeed:games.map(g=>({seed:g.seed,wins:g.challengerStats.wins}))});
 console.error("curriculum",stage,"vs",trainee,":",wins,"/",total);
}
console.log(JSON.stringify({methodology:"Skill-tier bot vs learning opponent; rotating seats and random kings. Success or failure is an operational proxy, not a test of real humans.",seeds,matchesPerSeed:matches,results},null,2));
