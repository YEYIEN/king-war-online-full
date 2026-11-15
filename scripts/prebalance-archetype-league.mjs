import assert from "node:assert/strict";
import {simulateKingBaseline} from "../server/index.js";
import {STRATEGY_ARCHETYPES} from "../server/ai-strategies.js";

const seeds=[28921,49333,69427];
const matches=Number(process.env.ARCHETYPE_MATCHES_PER_SEED||10);
const output=[];
for(const playerCount of [2,3,4,5]){
 for(const style of STRATEGY_ARCHETYPES){
  const runs=[];
  for(const seed of seeds){
   const r=await simulateKingBaseline({
    playerCount,matches,seed,maxTurns:180,difficulty:"hard",
    challenger:"conqueror",challengerStyle:style,
    conquerorSearch:true,conquerorProfile:"resource",comebackEnabled:true
   });
   assert.deepEqual(r.invariantViolations,{},`${style} ${playerCount}p ${seed}`);
   assert.equal(r.finished+r.unfinished,matches);
   runs.push(r);
  }
  const sum=fn=>runs.reduce((acc,run)=>acc+fn(run),0);
  const games=sum(run=>run.challengerStats.matches);
  const wins=sum(run=>run.challengerStats.wins);
  output.push({
    playerCount,style,games,wins,
    winRate:+(100*wins/games).toFixed(2),
    unfinished:sum(run=>run.challengerStats.unfinished),
    stalled:sum(run=>run.unfinishedReasons.stalledAITurn),
    byKing:Object.fromEntries(Object.keys(runs[0].challengerStats.gamesByKing).map(k=>[k,{
      games:sum(r=>r.challengerStats.gamesByKing[k]||0),
      wins:sum(r=>r.challengerStats.winsByKing[k]||0)
    }])),
    bySeat:Object.fromEntries(Object.keys(runs[0].challengerStats.gamesBySeat).map(k=>[k,{
      games:sum(r=>r.challengerStats.gamesBySeat[k]||0),
      wins:sum(r=>r.challengerStats.winsBySeat[k]||0)
    }]))
  });
  console.error("STYLE",playerCount,style,wins,"/",games);
 }
}
console.log(JSON.stringify({
 kind:"exploratory-bot-archetype-challenge",
 caveat:"Only deployment score differs; NOT yet a validated complete rush/defense/magic/multiturn strategy league",
 baseline:"hard",challenger:"conqueror",seeds,matchesPerSeed:matches,output
},null,2));
