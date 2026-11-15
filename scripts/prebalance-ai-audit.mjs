import assert from "node:assert/strict";
import { simulateKingBaseline } from "../server/index.js";
const SEEDS=[641321,729871,851267];
const matches=Number(process.env.PREBALANCE_MATCHES_PER_SEED||30);
const difficulties=["easy","normal","hard","conqueror"];
const results=[];
const ci=(wins,n)=>{
 if(!n)return [null,null];
 const z=1.96,p=wins/n,d=1+z*z/n,c=(p+z*z/(2*n))/d;
 const m=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
 return [+(100*(c-m)).toFixed(2),+(100*(c+m)).toFixed(2)];
};
for(const playerCount of [2,3,4,5])for(const challenger of difficulties){
 const runs=[];
 for(const seed of SEEDS){
  const r=await simulateKingBaseline({
   playerCount,seed,matches,maxTurns:180,difficulty:"hard",challenger,
   conquerorProfile:"resource",conquerorSearch:true,
   comebackEnabled:true
  });
  assert.deepEqual(r.invariantViolations,{},`${playerCount}p/${challenger}/${seed}`);
  assert.equal(r.finished+r.unfinished,matches);
  runs.push(r);
 }
 const sum=f=>runs.reduce((n,r)=>n+f(r),0);
 const played=sum(r=>r.challengerStats.matches),wins=sum(r=>r.challengerStats.wins);
 const bySeat={};
 const byKing={};
 for(const run of runs){
  for(const [seat,games] of Object.entries(run.challengerStats.gamesBySeat)){
   bySeat[seat]??={games:0,wins:0};
   bySeat[seat].games+=games;bySeat[seat].wins+=run.challengerStats.winsBySeat[seat]||0;
  }
  for(const [king,games] of Object.entries(run.challengerStats.gamesByKing)){
   byKing[king]??={games:0,wins:0};
   byKing[king].games+=games;byKing[king].wins+=run.challengerStats.winsByKing[king]||0;
  }
 }
 results.push({
  playerCount,challenger,opponents:"hard",games:played,wins,
  winRate:+(100*wins/played).toFixed(2),confidence95:ci(wins,played),
  unfinished:sum(r=>r.challengerStats.unfinished),
  stalledAITurn:sum(r=>r.unfinishedReasons.stalledAITurn),
  averageTurns:+(runs.reduce((n,r)=>n+r.averageTurns,0)/runs.length).toFixed(2),
  byKing,bySeat
 });
 console.error("AUDIT",playerCount,challenger,wins,played);
}
console.log(JSON.stringify({
 purpose:"Pre-balance AI policy diagnosis; NOT a game-rule balance conclusion",
 source:"server/index.js live-rules headless simulation",
 seeds:SEEDS,matchesPerSeed:matches,results
},null,2));
