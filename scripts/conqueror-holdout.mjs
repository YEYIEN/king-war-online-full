import assert from "node:assert/strict";
import { simulateKingBaseline } from "../server/index.js";

const seeds=[314159,271828,161803];
const scenarios=[
 {name:"duel-greedy-control",playerCount:2,search:false,matches:500},
 {name:"duel-resource-search",playerCount:2,search:true,matches:500},
 {name:"three-player-conqueror",playerCount:3,search:true,matches:250},
 {name:"four-player-conqueror",playerCount:4,search:true,matches:250},
 {name:"five-player-conqueror",playerCount:5,search:true,matches:250}
];
function wilson(wins,n){const z=1.96,p=wins/n,z2=z*z,d=1+z2/n;
 return [100*(p+z2/(2*n)-z*Math.sqrt(p*(1-p)/n+z2/(4*n*n)))/d,
         100*(p+z2/(2*n)+z*Math.sqrt(p*(1-p)/n+z2/(4*n*n)))/d].map(x=>+x.toFixed(2));}
const rows=[];
for(const scenario of scenarios){
 const runs=[];
 for(const seed of seeds){
  const game=await simulateKingBaseline({matches:scenario.matches,seed,playerCount:scenario.playerCount,
    difficulty:"hard",challenger:"conqueror",conquerorSearch:scenario.search,conquerorProfile:"resource",
    maxTurns:180,comebackEnabled:true});
  assert.deepEqual(game.invariantViolations,{});
  runs.push(game);
 }
 const total=runs.reduce((a,x)=>a+x.challengerStats.matches,0);
 const won=runs.reduce((a,x)=>a+x.challengerStats.wins,0);
 const byKing={},bySeat={};
 for(const x of runs){
  for(const [name,count] of Object.entries(x.challengerStats.gamesByKing)){
   byKing[name]??={games:0,wins:0};byKing[name].games+=count;
   byKing[name].wins+=x.challengerStats.winsByKing[name]||0;
  }
  for(const [id,count] of Object.entries(x.challengerStats.gamesBySeat)){
   bySeat[id]??={games:0,wins:0};bySeat[id].games+=count;
   bySeat[id].wins+=x.challengerStats.winsBySeat[id]||0;
  }
 }
 rows.push({name:scenario.name,players:scenario.playerCount,games:total,wins:won,
  winRate:+(100*won/total).toFixed(2),confidence95:wilson(won,total),
  expectedFairWinRate:+(100/scenario.playerCount).toFixed(2),
  bySeed:runs.map(x=>({seed:x.seed,rate:+(100*x.challengerStats.wins/x.challengerStats.matches).toFixed(2)})),
  byKing,bySeat,unfinished:runs.reduce((a,x)=>a+x.challengerStats.unfinished,0)});
 console.error("holdout",scenario.name,won,total);
}
console.log(JSON.stringify({methodology:"Out-of-training seeds, each seat rotated evenly; legal state/hidden hands only, challenger against hard AI",seeds,rows},null,2));
