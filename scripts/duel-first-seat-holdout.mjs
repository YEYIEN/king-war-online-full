import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import {simulateKingBaseline} from "../server/index.js";
const seeds=[1150349,2251187,3331523];
const perSeed=Number(process.env.DUEL_HOLDOUT_MATCHES_PER_SEED||1000);
const variants=[
 {id:"original",firstSeatPeacefulTurn:false,secondSeatExtraCards:0,firstSeatOpeningHandPenalty:0,firstSeatInitialDrawPenalty:0},
 {id:"simple-peace-card1",firstSeatPeacefulTurn:true,secondSeatExtraCards:1},
 {id:"primary-peace-card1-hand1",firstSeatPeacefulTurn:true,secondSeatExtraCards:1,firstSeatOpeningHandPenalty:1},
 {id:"backup-peace-card1-draw1",firstSeatPeacefulTurn:true,secondSeatExtraCards:1,firstSeatInitialDrawPenalty:1}
];
function pct(w,n){return n?+(100*w/n).toFixed(2):null;}
function wilson(w,n){
 const z=1.96,p=w/n,den=1+z*z/n,c=(p+z*z/(2*n))/den,r=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;
 return [pct(c-r,1),pct(c+r,1)];
}
const results=[];
for(const difficulty of ["normal","hard","conqueror"])for(const variant of variants){
 const runs=[];
 for(const seed of seeds){
  const {id,...settings}=variant;
  const r=await simulateKingBaseline({matches:perSeed,seed,playerCount:2,maxTurns:180,
   difficulty,conquerorSearch:true,conquerorProfile:"resource",comebackEnabled:true,
   includeMatchRecords:true,...settings});
  assert.deepEqual(r.invariantViolations,{});
  assert.equal(r.finished+r.unfinished,perSeed);
  assert.equal(r.unfinishedReasons.stalledAITurn,0);
  runs.push(r);
 }
 const sum=fn=>runs.reduce((total,r)=>total+fn(r),0);
 const n=sum(r=>r.seats["1"].games),w=sum(r=>r.seats["1"].wins);
 const kingSeat={},kingVersusKing={};
 const accumulated={rounds:0,unitAttacks:0,kingDamage:0,spells:0};
 for(const run of runs){
  accumulated.rounds+=run.averageTurns;
  accumulated.unitAttacks+=run.telemetry.unitAttacks;
  accumulated.kingDamage+=run.telemetry.kingDamage;
  accumulated.spells+=Object.values(run.telemetry.spells).reduce((a,b)=>a+b,0);
  for(const game of run.matchRecords){
   const first=game.players.find(player=>player.seat===1);
   const second=game.players.find(player=>player.seat===2);
   assert.ok(first && second);
   for(const player of [first,second]){
    const key=`${player.king}|seat${player.seat}`;
    kingSeat[key]??={games:0,wins:0};
    kingSeat[key].games++;
    if(game.finished&&game.winnerSeat===player.seat)kingSeat[key].wins++;
   }
   const matchup=`${first.king} vs ${second.king}`;
   kingVersusKing[matchup]??={games:0,firstWins:0};
   kingVersusKing[matchup].games++;
   if(game.finished&&game.winnerSeat===1)kingVersusKing[matchup].firstWins++;
  }
 }
 for(const o of Object.values(kingSeat))Object.assign(o,{winRate:pct(o.wins,o.games),ci95:wilson(o.wins,o.games)});
 for(const o of Object.values(kingVersusKing))Object.assign(o,{firstWinRate:pct(o.firstWins,o.games),ci95:wilson(o.firstWins,o.games)});
 const out={difficulty,id:variant.id,settings:variant,matches:n,firstWins:w,firstWinPct:pct(w,n),
  ci95:wilson(w,n),deviationFrom50:+(pct(w,n)-50).toFixed(2),
  avgTurns:+(accumulated.rounds/runs.length).toFixed(2),
  unfinished:sum(r=>r.unfinished),
  unfinishedReasons:{stalledAITurn:sum(r=>r.unfinishedReasons.stalledAITurn),
   turnLimit:sum(r=>r.unfinishedReasons.turnLimit),unexpected:sum(r=>r.unfinishedReasons.unexpected)},
  unitAttacks:accumulated.unitAttacks,kingDamage:accumulated.kingDamage,spellCasts:accumulated.spells,
  kingSeat,kingVersusKing};
 results.push(out);
 console.error("HOLDOUT",JSON.stringify({difficulty,id:variant.id,firstWins:w,matches:n,
  firstWinPct:out.firstWinPct,ci95:out.ci95,avgTurns:out.avgTurns,unfinished:out.unfinished}));
}
const result={schema:1,study:"pre-registered duel first-seat holdout after two exploratory experiments",
 rules:"isolated research-only first-seat flags; no game balance default changes",
 seeds,perSeed,matchCount:results.reduce((a,r)=>a+r.matches,0),results,
 notes:[
  "Independent seeds were not used in either exploration/calibration phase.",
  "Matching seeds across conditions does not imply identical random-card draws after changed actions.",
  "Observe each king x seat and matchup, not just total first-seat win rate.",
  "Normal is a secondary robustness sample; high difficulty and Conqueror are primary.",
  "Winner-only results are counted; unfinished games remain in the denominator.",
  "AI headless games alone do not establish human fairness."
 ]};
writeFileSync("duel-holdout-results.json",JSON.stringify(result,null,2));
const md=["# Independent holdout: King War duel opening equity","","| AI | Rule | First wins / 3000 | First win rate | Wilson 95% | Mean turns | Unfinished |",
 "|---|---|---:|---:|---|---:|---:|"];
for(const r of results)md.push(`| ${r.difficulty} | ${r.id} | ${r.firstWins}/${r.matches} | ${r.firstWinPct}% | ${r.ci95[0]}–${r.ci95[1]}% | ${r.avgTurns} | ${r.unfinished} |`);
md.push("","## Scope","","- Research-only rules; no official gameplay change.","- King-by-seat and ordered king matchups in JSON.","- No claim of perfectly equal odds or human match equity.");
writeFileSync("duel-holdout-results.md",md.join("\n")+"\n");
console.log(JSON.stringify({matches:result.matchCount,results:results.map(({difficulty,id,firstWinPct,ci95,avgTurns,unfinished})=>({difficulty,id,firstWinPct,ci95,avgTurns,unfinished}))},null,2));
