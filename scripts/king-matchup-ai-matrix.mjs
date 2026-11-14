import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import {simulateKingBaseline} from "../server/index.js";

const kings=["亞歷山大大帝","屋大維奧古斯都","成吉思汗","秦始皇","路易十四"];
const seeds=[373379,487123,709133]; // independent from prior balance exploration
const pairMatches=Number(process.env.KING_MATRIX_MATCHES_PER_SEED||35);
const multiMatches=Number(process.env.KING_MULTI_MATCHES_PER_SEED||90);
const arms=[
 {id:"hard-control",difficulty:"hard",challenger:"hard",kingPlan:false,counterPlan:false},
 {id:"hard-own-king",difficulty:"hard",challenger:"hard",kingPlan:true,counterPlan:false},
 {id:"conqueror-control",difficulty:"conqueror",challenger:"conqueror",kingPlan:false,counterPlan:false},
 {id:"conqueror-own-king",difficulty:"conqueror",challenger:"conqueror",kingPlan:true,counterPlan:false},
 {id:"conqueror-counter-king",difficulty:"conqueror",challenger:"conqueror",kingPlan:false,counterPlan:true},
 {id:"conqueror-combined",difficulty:"conqueror",challenger:"conqueror",kingPlan:true,counterPlan:true}
];
const pct=(a,b)=>b>0?+(100*a/b).toFixed(2):null;
const wilson=(w,n)=>{
 if(!n)return null;
 const z=1.96,p=w/n,denom=1+z*z/n,mid=(p+z*z/(2*n))/denom,span=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/denom;
 return [pct(mid-span,1),pct(mid+span,1)];
};
const rows=[];
async function sample({arm,playerCount,kingPair,matches,runId}){
 const results=[];
 for(const seed of seeds){
  const r=await simulateKingBaseline({
   seed,matches,playerCount,difficulty:arm.difficulty,challenger:arm.challenger,
   challengerKingPlan:arm.kingPlan,challengerCounterPlan:arm.counterPlan,
   kingPair,maxTurns:180,comebackEnabled:true,
   conquerorSearch:true,conquerorProfile:"resource"
  });
  assert.deepEqual(r.invariantViolations,{},`invariants failed: ${runId}/${seed}`);
  assert.equal(r.finished+r.unfinished,matches,`missing games: ${runId}`);
  assert.equal(r.unfinishedReasons.stalledAITurn,0,`stalled game: ${runId}`);
  if(kingPair)assert.equal(r.challengerStats.gamesByKing[kingPair[0]],matches,
    `king control failed: ${runId}/${seed}`);
  results.push(r);
 }
 const sum=f=>results.reduce((a,r)=>a+f(r),0);
 const games=sum(r=>r.challengerStats.matches);
 const wins=sum(r=>r.challengerStats.wins);
 const kingStats={};
 for(const k of kings){
  const n=sum(r=>r.challengerStats.gamesByKing[k]||0),w=sum(r=>r.challengerStats.winsByKing[k]||0);
  kingStats[k]={games:n,wins:w,rate:pct(w,n)};
 }
 const seatStats={};
 for(const seat of Array.from({length:playerCount},(_,i)=>String(i+1))){
  const n=sum(r=>r.challengerStats.gamesBySeat[seat]||0),w=sum(r=>r.challengerStats.winsBySeat[seat]||0);
  seatStats[seat]={games:n,wins:w,rate:pct(w,n)};
 }
 return {
  runId,arm:arm.id,playerCount,kingPair,
  games,wins,winRate:pct(wins,games),ci95:wilson(wins,games),
  unfinished:sum(r=>r.unfinished),kingStats,seatStats,
  averageTurns:+(results.reduce((n,r)=>n+r.averageTurns,0)/results.length).toFixed(2)
 };
}
for(const ownedKing of kings)for(const enemyKing of kings){
 if(ownedKing===enemyKing)continue; // draft king draw permits only unique kings
 for(const arm of arms){
  const runId=`${arm.id}:${ownedKing}:${enemyKing}`;
  const row=await sample({arm,playerCount:2,kingPair:[ownedKing,enemyKing],matches:pairMatches,runId});
  rows.push(row);
  console.error("MATCHUP",JSON.stringify({arm:arm.id,own:ownedKing,enemy:enemyKing,rate:row.winRate,n:row.games,w:row.wins,seat1:row.seatStats["1"].rate,seat2:row.seatStats["2"].rate}));
 }
}
for(const playerCount of [4,5])for(const arm of [
 arms[0],arms[1],arms[2],arms[3],arms[4],arms[5]
]){
 const runId=`${arm.id}:${playerCount}p`;
 const row=await sample({arm,playerCount,kingPair:null,matches:multiMatches,runId});
 rows.push(row);
 console.error("MULTI",JSON.stringify({arm:arm.id,n:row.games,w:row.wins,rate:row.winRate,players:playerCount,
  kings:Object.fromEntries(Object.entries(row.kingStats).map(([k,v])=>[k,v.rate]))}));
}
const summaries=[];
for(const arm of arms){
 for(const group of ["duel","4p","5p"]){
  const current=rows.filter(row=>row.arm===arm.id&&(group==="duel"?!!row.kingPair:row.playerCount===Number(group[0])));
  const games=current.reduce((a,r)=>a+r.games,0),wins=current.reduce((a,r)=>a+r.wins,0);
  summaries.push({arm:arm.id,group,games,wins,winRate:pct(wins,games),ci95:wilson(wins,games)});
 }
}
const out={
 study:"King choice, own-king policies and enemy-king counterplay",rulesRef:"Draft PR #7, simulation-only per-AI flags",
 seeds,pairMatchesPerSeed:pairMatches,multiMatchesPerSeed:multiMatches,arms,
 scenarioCount:rows.length,games:rows.reduce((sum,row)=>sum+row.games,0),
 caveats:[
  "Per-bot king-specific policies only. No king cards, magic, damage, hands or live defaults changed.",
  "Own/enemy king assignment fixed before opening draws, without duplicating kings.",
  "Control/treatment games use the same seeds but may diverge in PRNG consumption following behavior changes.",
  "Matchup CI95 reflects game-level binomial uncertainty, not clustered seed/deck or model uncertainty.",
  "These are baseline versus one modified challenger, NOT all AI opponents adopting new policy.",
  "A/B success in AI competitions does not prove that a king rule needs balancing."
 ],rows,summaries
};
writeFileSync("king-matchup-ai-matrix.json",JSON.stringify(out,null,2));
writeFileSync("king-matchup-ai-summary.md",[
 "# King War king-selection and counterplay research",
 "",
 `- Rules: Draft PR #7, simulation-only policies`,
 `- Total: ${out.games} games over ${out.scenarioCount} experimental scenarios`,
 `- King pairs: ${kings.length*(kings.length-1)} directed unique matchups`,
 "",
 "| AI | Player count | Games | Win rate | CI95 |",
 "|---|---|---:|---:|---|",
 ...summaries.map(r=>`| ${r.arm} | ${r.group} | ${r.games} | ${r.winRate}% | ${r.ci95.join("–")}% |`),
 "",
 "Interpretation: control vs upgraded challenger win rates, not a historical comparison of the whole player population.",
 "Read king-matchup-ai-matrix.json for each king-vs-king result, king and seat stratification, and negative cases."
].join("\n")+"\n");
console.log(JSON.stringify({scenarioCount:rows.length,games:out.games,summaries}));
