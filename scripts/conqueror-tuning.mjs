import assert from "node:assert/strict";
import { simulateKingBaseline } from "../server/index.js";
const seeds=[104729,130363,196613];
const matches=Number(process.env.TUNING_MATCHES_PER_SEED||300);
const variants=[
 {name:"greedy-control",conquerorSearch:false,conquerorProfile:"balanced"},
 {name:"beam-balanced",conquerorSearch:true,conquerorProfile:"balanced"},
 {name:"beam-assault",conquerorSearch:true,conquerorProfile:"assault"},
 {name:"beam-resource",conquerorSearch:true,conquerorProfile:"resource"}
];
const results=[];
for(const variant of variants){
 let wins=0,unfinished=0,games=0,bySeed=[],kingStats={},seats={};
 for(const seed of seeds){
  const x=await simulateKingBaseline({seed,matches,playerCount:2,difficulty:"hard",
   challenger:"conqueror",conquerorSearch:variant.conquerorSearch,
   conquerorProfile:variant.conquerorProfile,comebackEnabled:true,maxTurns:180});
  assert.deepEqual(x.invariantViolations,{});
  assert.equal(x.challengerStats.matches,matches);
  wins+=x.challengerStats.wins;unfinished+=x.challengerStats.unfinished;games+=matches;
  bySeed.push({seed,wins:x.challengerStats.wins});
  for(const [k,count] of Object.entries(x.challengerStats.gamesByKing)) {
   kingStats[k]??={games:0,wins:0};kingStats[k].games+=count;
   kingStats[k].wins+=x.challengerStats.winsByKing[k]||0;
  }
  for(const [k,count] of Object.entries(x.challengerStats.gamesBySeat)) {
   seats[k]??={games:0,wins:0};seats[k].games+=count;
   seats[k].wins+=x.challengerStats.winsBySeat[k]||0;
  }
 }
 results.push({...variant,wins,games,unfinished,winRate:+(100*wins/games).toFixed(2),bySeed,kingStats,seats});
 console.error(variant.name, wins,"/",games);
}
console.log(JSON.stringify({description:"Paired initial seeds and seats; actual game AI, equal rules, simulation results only.",seeds,matches,results},null,2));
