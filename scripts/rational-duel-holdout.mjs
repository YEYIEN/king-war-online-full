import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import {simulateKingBaseline} from "../server/index.js";
const seeds=[1559219,1689041,1910839]; // NOT used to tune planner
const gamesPerSeed=Number(process.env.RATIONAL_DUEL_GAMES_PER_SEED||200);
const arms=[
 {id:"legacy",rational:false,own:false},
 {id:"rational",rational:true,own:false},
 {id:"rational-with-king",rational:true,own:true}
];
const wilson=(w,n)=>{
 if(!n)return null;
 const p=w/n,z=1.96,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
 return [+(100*(c-h)).toFixed(2),+(100*(c+h)).toFixed(2)];
};
const rows=[];
for(const opponentDifficulty of ["hard","conqueror"])for(const arm of arms){
 const runs=[];
 for(const seed of seeds){
  const r=await simulateKingBaseline({
   matches:gamesPerSeed,seed,playerCount:2,
   difficulty:opponentDifficulty,challenger:"conqueror",
   challengerRationalSearch:arm.rational,challengerKingPlan:arm.own,
   maxTurns:180,comebackEnabled:true,conquerorSearch:true,conquerorProfile:"resource"
  });
  assert.deepEqual(r.invariantViolations,{},`invariant ${arm.id}/${opponentDifficulty}/${seed}`);
  assert.equal(r.finished+r.unfinished,gamesPerSeed);
  assert.equal(r.unfinishedReasons.stalledAITurn,0);
  runs.push(r);
 }
 const sum=fn=>runs.reduce((a,r)=>a+fn(r),0);
 const n=sum(r=>r.challengerStats.matches),w=sum(r=>r.challengerStats.wins);
 const byKing=Object.fromEntries(Object.keys(runs[0].challengerStats.gamesByKing).map(k=>{
  const games=sum(r=>r.challengerStats.gamesByKing[k]||0);
  const wins=sum(r=>r.challengerStats.winsByKing[k]||0);
  return [k,{games,wins,winRate:games?+(wins/games*100).toFixed(2):null}];
 }));
 const bySeat=Object.fromEntries(["1","2"].map(k=>{
  const games=sum(r=>r.challengerStats.gamesBySeat[k]||0);
  const wins=sum(r=>r.challengerStats.winsBySeat[k]||0);
  return [k,{games,wins,winRate:games?+(wins/games*100).toFixed(2):null}];
 }));
 const stats={
  calls:sum(r=>r.telemetry.rationalCalls||0),
  passes:sum(r=>r.telemetry.rationalPasses||0),
  changed:sum(r=>r.telemetry.rationalChanged||0),
  nodes:sum(r=>r.telemetry.rationalNodes||0)
 };
 rows.push({opponentDifficulty,policy:arm.id,games:n,wins:w,winRate:+(100*w/n).toFixed(2),
  confidence95:wilson(w,n),unfinished:sum(r=>r.unfinished),byKing,bySeat,stats});
 console.error("DUEL_HOLDOUT",JSON.stringify(rows.at(-1)));
}
const out={note:"New independent unseen seed set, exploratory validation of rational Conqueror attack phase against hard/conqueror",
 seeds,gamesPerSeed,totalGames:rows.reduce((a,r)=>a+r.games,0),
 caveats:["Real opponent draws and hidden cards NOT predicted by rational planner","Games are not perfectly coupled despite shared initial seeds","The utility function approximates first-place probability, it is not calibrated"],rows};
writeFileSync("rational-duel-holdout.json",JSON.stringify(out,null,2));
console.log(JSON.stringify({totalGames:out.totalGames,rows:rows.map(x=>({opponent:x.opponentDifficulty,policy:x.policy,wins:x.wins,games:x.games,pct:x.winRate,ci:x.confidence95,stats:x.stats}))}));
