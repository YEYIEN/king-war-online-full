import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import {simulateKingBaseline} from "../server/index.js";

const seeds=[113771,224803,335999];
const matches=Number(process.env.DUEL_EXPLORATION_MATCHES||250);
const modes=[
 {id:"original",firstSeatPeacefulTurn:false,openingTruceEnabled:false,secondSeatExtraCards:0},
 {id:"first-peace",firstSeatPeacefulTurn:true,openingTruceEnabled:false,secondSeatExtraCards:0},
 {id:"second-card-1",firstSeatPeacefulTurn:false,openingTruceEnabled:false,secondSeatExtraCards:1},
 {id:"second-card-2",firstSeatPeacefulTurn:false,openingTruceEnabled:false,secondSeatExtraCards:2},
 {id:"first-peace-card-1",firstSeatPeacefulTurn:true,openingTruceEnabled:false,secondSeatExtraCards:1},
 {id:"first-peace-card-2",firstSeatPeacefulTurn:true,openingTruceEnabled:false,secondSeatExtraCards:2},
 {id:"both-peace",firstSeatPeacefulTurn:false,openingTruceEnabled:true,secondSeatExtraCards:0},
 {id:"both-peace-card-1",firstSeatPeacefulTurn:false,openingTruceEnabled:true,secondSeatExtraCards:1},
 {id:"both-peace-card-2",firstSeatPeacefulTurn:false,openingTruceEnabled:true,secondSeatExtraCards:2}
];
const rate=(a,b)=>b?+(100*a/b).toFixed(2):null;
function wilson(w,n){
 const z=1.96,p=w/n,t=1+z*z/n,c=(p+z*z/(2*n))/t,e=z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)/t;
 return [rate(c-e,0.01),rate(c+e,0.01)].map(x=>+(x/100).toFixed(2));
}
const results=[];
for(const difficulty of ["hard","conqueror"]){
 for(const mode of modes){
  const runs=[];
  for(const seed of seeds){
   const run=await simulateKingBaseline({
    matches,seed,playerCount:2,difficulty,maxTurns:180,comebackEnabled:true,
    conquerorSearch:true,conquerorProfile:"resource",includeMatchRecords:true,
    ...mode
   });
   assert.deepEqual(run.invariantViolations,{});
   assert.equal(run.finished+run.unfinished,matches);
   assert.equal(run.unfinishedReasons.stalledAITurn,0);
   runs.push(run);
  }
  const sum=fn=>runs.reduce((n,r)=>n+fn(r),0);
  const n=sum(r=>r.seats["1"].games),w=sum(r=>r.seats["1"].wins);
  const kingSeats={};
  for(const r of runs)for(const m of r.matchRecords){
    for(const player of m.players){
      const key=player.king+"|"+player.seat;
      kingSeats[key]??={games:0,wins:0};
      kingSeats[key].games++;
      if(m.finished && m.winnerSeat===player.seat)kingSeats[key].wins++;
    }
  }
  for(const entry of Object.values(kingSeats))entry.rate=rate(entry.wins,entry.games);
  const result={difficulty,mode:mode.id,settings:mode,matches:n,wins:w,
   firstSeatRate:rate(w,n),ci95:wilson(w,n),deltaFrom50:rate(w,n)-50,
   averageTurns:+(runs.reduce((s,r)=>s+r.averageTurns,0)/runs.length).toFixed(2),
   unfinished:sum(r=>r.unfinished),kingSeats,
   completeRate:rate(sum(r=>r.finished),n)};
  results.push(result);
  console.error("DUEL",difficulty,mode.id,JSON.stringify({
    wins:w,games:n,firstSeatRate:result.firstSeatRate,ci95:result.ci95,
    turns:result.averageTurns,unfinished:result.unfinished
  }));
 }
}
const output={schema:1,rules:"PR #7 research flags only, unchanged game content",seeds,matchesPerSeed:matches,
 matchCount:results.reduce((n,r)=>n+r.matches,0),
 notes:["Same-seed comparisons are not necessarily paired because game decisions consume random draws differently.",
  "All conditions are AI vs AI, not human gameplay.",
  "Do not select by nearest observed 50% without independent holdout and king-seat review."],
 results};
writeFileSync("duel-first-seat-exploration.json",JSON.stringify(output,null,2));
const lines=["# Duel first-seat bias: exploration","",
 `${output.matchCount} simulated games, no game rule adopted.`,"",
 "| AI | Candidate | First wins | Total | First % | 95% Wilson | Avg turns | Unfinished |",
 "|---|---|---:|---:|---:|---|---:|---:|"];
for(const r of results)lines.push(`| ${r.difficulty} | ${r.mode} | ${r.wins} | ${r.matches} | ${r.firstSeatRate}% | ${r.ci95[0]}–${r.ci95[1]}% | ${r.averageTurns} | ${r.unfinished} |`);
lines.push("","## Selection rule","","Treat 47–53% as aspirational, not a guarantee. Prefer a candidate with consistent hard/conqueror effects, acceptable king-seat outliers and no material match-length or completion regression. Use fresh holdout seeds before adoption.");
writeFileSync("duel-first-seat-exploration.md",lines.join("\n")+"\n");
console.log(JSON.stringify({matchCount:output.matchCount,results:results.map(({difficulty,mode,firstSeatRate,ci95,averageTurns,unfinished})=>({difficulty,mode,firstSeatRate,ci95,averageTurns,unfinished}))},null,2));
