import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { simulateKingBaseline } from "../server/index.js";

const seeds=[701921,802403,903617];
const matches=Number(process.env.BALANCE_MATCHES_PER_SEED||250);
const scenarios=[
  ...["hard","conqueror"].flatMap(difficulty=>[
    {id:`duel-${difficulty}-baseline`,playerCount:2,difficulty,firstSeatPeacefulTurn:false,secondSeatExtraCards:0},
    {id:`duel-${difficulty}-truce-only`,playerCount:2,difficulty,firstSeatPeacefulTurn:true,secondSeatExtraCards:0},
    {id:`duel-${difficulty}-card-only`,playerCount:2,difficulty,firstSeatPeacefulTurn:false,secondSeatExtraCards:1},
    {id:`duel-${difficulty}-combined`,playerCount:2,difficulty,firstSeatPeacefulTurn:true,secondSeatExtraCards:1}
  ]),
  ...[3,4,5].flatMap(playerCount=>["normal","hard","conqueror"].map(difficulty=>({
    id:`p${playerCount}-${difficulty}-baseline`,playerCount,difficulty
  }))),
  {id:"duel-normal-baseline",playerCount:2,difficulty:"normal"},
  {id:"p4-normal-louis-mage",playerCount:4,difficulty:"normal",louisMageSetup:true},
  {id:"p5-normal-louis-mage",playerCount:5,difficulty:"normal",louisMageSetup:true},
  {id:"p4-normal-magic-targeting",playerCount:4,difficulty:"normal",aiMagicTargeting:true},
  {id:"p5-normal-magic-targeting",playerCount:5,difficulty:"normal",aiMagicTargeting:true},
  {id:"p3-hard-no-laststand",playerCount:3,difficulty:"hard",comebackEnabled:false},
  {id:"p4-hard-no-laststand",playerCount:4,difficulty:"hard",comebackEnabled:false},
  {id:"p5-hard-no-laststand",playerCount:5,difficulty:"hard",comebackEnabled:false},
  {id:"p5-conqueror-no-laststand",playerCount:5,difficulty:"conqueror",comebackEnabled:false},
  {id:"p5-hard-defense-rally-experiment",playerCount:5,difficulty:"hard",defenseRallyEnabled:true},
  {id:"p5-conqueror-defense-rally-experiment",playerCount:5,difficulty:"conqueror",defenseRallyEnabled:true},
  {id:"p4-hard-vs-conqueror-challenger",playerCount:4,difficulty:"hard",challenger:"conqueror"},
  {id:"p5-hard-vs-conqueror-challenger",playerCount:5,difficulty:"hard",challenger:"conqueror"}
];
const wilson=(w,n)=>{
  if(!n)return null;
  const z=1.96,p=w/n,denom=1+z*z/n,mid=(p+z*z/(2*n))/denom,err=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/denom;
  return [+(100*(mid-err)).toFixed(2),+(100*(mid+err)).toFixed(2)];
};
const rate=(w,n)=>n?+(100*w/n).toFixed(2):null;
const records=[];
for(const scenario of scenarios){
 const runs=[];
 for(const seed of seeds){
  const {id,...settings}=scenario;
  const run=await simulateKingBaseline({
    matches,seed,maxTurns:180,comebackEnabled:true,conquerorSearch:true,
    conquerorProfile:"resource",...settings
  });
  assert.deepEqual(run.invariantViolations,{},`invariants ${id}/${seed}`);
  assert.equal(run.finished+run.unfinished,matches);
  assert.equal(run.unfinishedReasons.stalledAITurn,0,`AI stall ${id}/${seed}`);
  runs.push(run);
 }
 const sum=fn=>runs.reduce((a,b)=>a+fn(b),0);
 const byKing=Object.fromEntries(Object.keys(runs[0].kings).map(k=>{
  const games=sum(r=>r.kings[k].games),wins=sum(r=>r.kings[k].wins);
  return [k,{games,wins,winRate:rate(wins,games),ci95:wilson(wins,games)}];
 }));
 const bySeat=Object.fromEntries(Object.keys(runs[0].seats).map(k=>{
  const games=sum(r=>r.seats[k].games),wins=sum(r=>r.seats[k].wins);
  return [k,{games,wins,winRate:rate(wins,games),ci95:wilson(wins,games)}];
 }));
 const spells={};
 for(const r of runs)for(const [spell,uses] of Object.entries(r.telemetry.spells)){
  spells[spell]??={casts:0,changedState:0};
  spells[spell].casts+=uses;
  spells[spell].changedState+=r.telemetry.spellsEffective[spell]||0;
 }
 for(const entry of Object.values(spells))entry.changedStatePct=rate(entry.changedState,entry.casts);
 const crises=sum(r=>r.resultMetrics.completedMatchesWithCriticalPlayer),crisisWins=sum(r=>r.resultMetrics.criticalComebackWins);
 const behind=sum(r=>r.resultMetrics.completedMatchesWithTrailingPlayer),behindWins=sum(r=>r.resultMetrics.actualComebackWins);
 const rec={
  scenario:scenario.id,playerCount:scenario.playerCount,difficulty:scenario.difficulty,settings:scenario,
  seeds,matchesPerSeed:matches,matches:matches*seeds.length,finished:sum(r=>r.finished),unfinished:sum(r=>r.unfinished),
  unfinishedReasons:{turnLimit:sum(r=>r.unfinishedReasons.turnLimit),stalledAITurn:sum(r=>r.unfinishedReasons.stalledAITurn),unexpected:sum(r=>r.unfinishedReasons.unexpected)},
  averageTurns:+(runs.reduce((a,r)=>a+r.averageTurns,0)/runs.length).toFixed(2),
  byKing,bySeat,
  crises:{eligibleMatches:crises,wins:crisisWins,winRate:rate(crisisWins,crises),ci95:wilson(crisisWins,crises)},
  behind:{eligibleMatches:behind,wins:behindWins,winRate:rate(behindWins,behind),ci95:wilson(behindWins,behind)},
  comeback:{assaultUses:sum(r=>r.comebackUse.assault),defenseUses:sum(r=>r.comebackUse.defense),winsUsingLastStand:sum(r=>r.resultMetrics.comebackWinsUsingLastStand)},
  combat:{unitAttacks:sum(r=>r.telemetry.unitAttacks),mutualKills:sum(r=>r.telemetry.mutualKills),failedTrades:sum(r=>r.telemetry.failedTrades),kingAttacks:sum(r=>r.telemetry.kingAttacks),kingDamage:sum(r=>r.telemetry.kingDamage),deployments:sum(r=>r.telemetry.aiDeployments),mongolRecalls:sum(r=>r.telemetry.mongolRecalls)},
  spells
 };
 if(scenario.challenger){
  const n=sum(r=>r.challengerStats.matches),w=sum(r=>r.challengerStats.wins);
  rec.challenger={games:n,wins:w,winRate:rate(w,n),ci95:wilson(w,n)};
 }
 records.push(rec);
 console.error("EVIDENCE",JSON.stringify({
  id:rec.scenario,done:rec.finished,total:rec.matches,turns:rec.averageTurns,
  seats:Object.fromEntries(Object.entries(rec.bySeat).map(([k,v])=>[k,v.winRate])),
  kings:Object.fromEntries(Object.entries(rec.byKing).map(([k,v])=>[k,v.winRate])),
  crisis:rec.crises,comeback:rec.comeback,challenger:rec.challenger||null
 }));
}
const result={
 schema:1,purpose:"Exploratory pre-balance factorial study; no live-game rule changes",
 rulesRef:"PR #7 feature/prebalance-hardening-ai-20261114",seeds,matchesPerSeed:matches,
 notes:[
  "Every scenario uses identical seed numbers but random consumption can diverge after changed decisions, so these are not necessarily fully paired outcomes.",
  "King denominators include unfinished matches; wins require actual final winner.",
  "Spells changedStatePct means observed field/status change, not strategic effectiveness.",
  "All-hard/all-conqueror configurations are homogeneous AI, not a human player estimate.",
  "Exploration results are hypothesis-generating; verify candidates on separate holdout seeds before adoption."
 ],scenarios:records
};
writeFileSync("balance-factorial-raw.json",JSON.stringify(result,null,2));
const md=["# King War exploratory factorial simulation results","",
 `- Rules: Draft PR #7; **no balance rule activated in production**`,
 `- Runs: ${records.length} scenarios × ${matches} games × ${seeds.length} seeds = ${records.length*matches*seeds.length} simulated matches.`,
 "- King/seat win rates are scenario-conditioned; comparison across scenarios is not causal without matched random streams and robust holdouts.",
 "", "| Scenario | Games | Complete | Seat 1 win % | Critical comeback % | Average turns |","|---|---:|---:|---:|---:|---:|"];
for(const r of records)md.push(`| ${r.scenario} | ${r.matches} | ${r.finished} | ${r.bySeat["1"]?.winRate??"—"} | ${r.crises.winRate??"—"} (${r.crises.wins}/${r.crises.eligibleMatches}) | ${r.averageTurns} |`);
md.push("","## Interpretation safeguards","See JSON for kings, CI95, all seats, combat and spells. Magic observed state changes are not causal benefits.");
writeFileSync("balance-factorial-summary.md",md.join("\n")+"\n");
console.log(JSON.stringify({scenarioCount:records.length,matches:records.length*matches*seeds.length,records:records.map(r=>({
  id:r.scenario,finished:r.finished,seat1:r.bySeat["1"]?.winRate,
  kings:Object.fromEntries(Object.entries(r.byKing).map(([k,v])=>[k,{w:v.wins,n:v.games,p:v.winRate}])),
  crisis:r.crises,comeback:r.comeback,challenger:r.challenger||null,turns:r.averageTurns
}))}));
