import assert from "node:assert/strict";
import {simulateKingBaseline} from "../server/index.js";
const SEEDS=[502277,681059,911773];
const TIERS=["easy","normal","hard","conqueror"];
const perSeed=Number(process.env.PREBALANCE_LEAGUE_MATCHES_PER_SEED||30);
const rate=(w,n)=>n?+(100*w/n).toFixed(2):null;
const results=[];
for(const opponent of TIERS)for(const challenger of TIERS){
 const runs=[];
 for(const seed of SEEDS){
  const r=await simulateKingBaseline({
   matches:perSeed,seed,playerCount:2,maxTurns:180,difficulty:opponent,
   challenger,conquerorSearch:true,conquerorProfile:"resource",comebackEnabled:true
  });
  assert.deepEqual(r.invariantViolations,{});
  assert.equal(r.finished+r.unfinished,perSeed);
  runs.push(r);
 }
 const sum=f=>runs.reduce((n,r)=>n+f(r),0);
 const games=sum(r=>r.challengerStats.matches);
 const wins=sum(r=>r.challengerStats.wins);
 const seats={};
 for(const r of runs)for(const [seat,n] of Object.entries(r.challengerStats.gamesBySeat)){
  seats[seat]??={games:0,wins:0};
  seats[seat].games+=n;
  seats[seat].wins+=r.challengerStats.winsBySeat[seat]||0;
 }
 results.push({challenger,opponent,games,wins,winRate:rate(wins,games),
  unfinished:sum(r=>r.challengerStats.unfinished),
  stalls:sum(r=>r.unfinishedReasons.stalledAITurn),seats});
 console.error("LEAGUE",challenger,"vs",opponent,wins,games);
}
console.log(JSON.stringify({
 warning:"AI tier versus tier only; NOT yet a heterogeneous rush/defense/spell/archetype tournament",
 seeds:SEEDS,perSeed,results
},null,2));
