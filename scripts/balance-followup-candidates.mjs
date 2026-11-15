import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import {simulateKingBaseline} from "../server/index.js";
const seeds=[1020149,1047297,1103515];
const matches=Number(process.env.FOLLOWUP_MATCHES_PER_SEED||250);
const cases=[];
for(const difficulty of ["hard","conqueror"]){
  cases.push({id:`p2-${difficulty}-base`,playerCount:2,difficulty});
  cases.push({id:`p2-${difficulty}-full-first-round-truce`,playerCount:2,difficulty,openingTruceEnabled:true});
}
for(const playerCount of [3,4,5]){
  cases.push({id:`p${playerCount}-conqueror-base`,playerCount,difficulty:"conqueror"});
  for(const limit of [1,0])cases.push({id:`p${playerCount}-conqueror-genghis-recall-${limit}`,playerCount,difficulty:"conqueror",genghisDrawLimit:limit});
  cases.push({id:`p${playerCount}-conqueror-no-cavalry-guarantee`,playerCount,difficulty:"conqueror",genghisGuaranteedCavalry:false});
}
for(const playerCount of [4,5]){
  cases.push({id:`p${playerCount}-normal-base`,playerCount,difficulty:"normal"});
  cases.push({id:`p${playerCount}-normal-opening-truce`,playerCount,difficulty:"normal",openingTruceEnabled:true});
  cases.push({id:`p${playerCount}-conqueror-qin-extra-opening`,playerCount,difficulty:"conqueror",qinOpeningBonus:true});
}
cases.push({id:"p5-hard-base",playerCount:5,difficulty:"hard"});
cases.push({id:"p5-hard-genghis-recall-1",playerCount:5,difficulty:"hard",genghisDrawLimit:1});
const rate=(w,n)=>n?+(w/n*100).toFixed(2):null;
const rows=[];
for(const item of cases){
  const runs=[];
  for(const seed of seeds){
    const {id,...args}=item;
    const r=await simulateKingBaseline({matches,seed,maxTurns:180,comebackEnabled:true,...args});
    assert.deepEqual(r.invariantViolations,{},`${item.id}/${seed}`);
    assert.equal(r.finished+r.unfinished,matches);
    assert.equal(r.unfinishedReasons.stalledAITurn,0);
    runs.push(r);
  }
  const sum=f=>runs.reduce((a,b)=>a+f(b),0);
  const kings=Object.fromEntries(Object.keys(runs[0].kings).map(k=>{
    const n=sum(r=>r.kings[k].games),w=sum(r=>r.kings[k].wins);
    return [k,{games:n,wins:w,rate:rate(w,n)}];
  }));
  const seats=Object.fromEntries(Object.keys(runs[0].seats).map(k=>{
    const n=sum(r=>r.seats[k].games),w=sum(r=>r.seats[k].wins);
    return [k,{games:n,wins:w,rate:rate(w,n)}];
  }));
  const risk=sum(r=>r.resultMetrics.completedMatchesWithCriticalPlayer);
  const riskWins=sum(r=>r.resultMetrics.criticalComebackWins);
  const row={id:item.id,conditions:item,matches:matches*seeds.length,finished:sum(r=>r.finished),seeds,byKing:kings,bySeat:seats,
   averageTurns:+(runs.reduce((a,b)=>a+b.averageTurns,0)/runs.length).toFixed(2),
   crisis:{eligible:risk,wins:riskWins,rate:rate(riskWins,risk)},
   comeback:{assault:sum(r=>r.comebackUse.assault),defense:sum(r=>r.comebackUse.defense)},
   combat:{recalls:sum(r=>r.telemetry.mongolRecalls),damage:sum(r=>r.telemetry.kingDamage)}};
  rows.push(row);
  console.error("FOLLOWUP",JSON.stringify({id:row.id,finished:row.finished,averageTurns:row.averageTurns,kings:Object.fromEntries(Object.entries(kings).map(([k,v])=>[k,v.rate])),seats:Object.fromEntries(Object.entries(seats).map(([k,v])=>[k,v.rate])),crisis:row.crisis,recalls:row.combat.recalls}));
}
const out={study:"Independent followup exploratory candidate research",rulesRef:"Draft PR #7",seeds,matchesPerSeed:matches,totalMatches:rows.length*matches*seeds.length,
 caveats:["different policy paths may consume random numbers differently","one AI per seat, not human data","all numeric policy changes simulation-only","confidence intervals and stratified holdouts required before deployment"],rows};
writeFileSync("balance-followup-raw.json",JSON.stringify(out,null,2));
console.log(JSON.stringify({scenarios:rows.length,totalMatches:out.totalMatches}));
