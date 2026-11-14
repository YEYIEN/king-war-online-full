import assert from "node:assert/strict";
import {simulateKingBaseline} from "../server/index.js";

const seeds=[404203,558721,887503];
const matches=Number(process.env.MATCHES_PER_SEED||200);
const experiments=[
 {id:"duel-legacy",players:2,difficulty:"hard",settings:{firstSeatPeacefulTurn:false,secondSeatExtraCards:0,comebackEnabled:true}},
 {id:"duel-fair-opening",players:2,difficulty:"hard",settings:{firstSeatPeacefulTurn:true,secondSeatExtraCards:1,comebackEnabled:true}},
 {id:"five-hard-laststand",players:5,difficulty:"hard",settings:{comebackEnabled:true}},
 {id:"five-hard-without-laststand",players:5,difficulty:"hard",settings:{comebackEnabled:false}},
 {id:"four-normal",players:4,difficulty:"normal",settings:{comebackEnabled:true}},
 {id:"five-normal",players:5,difficulty:"normal",settings:{comebackEnabled:true}},
 {id:"five-easy",players:5,difficulty:"easy",settings:{comebackEnabled:true}}
];
const out=[];
function rate(w,n){return n>0?+(100*w/n).toFixed(2):null}
for(const scenario of experiments){
 const runs=[];
 for(const seed of seeds) {
  const r=await simulateKingBaseline({matches,playerCount:scenario.players,
   difficulty:scenario.difficulty,seed,maxTurns:180,...scenario.settings});
  assert.deepEqual(r.invariantViolations,{},`invalid state ${scenario.id}`);
  runs.push(r);
 }
 const sum=selector=>runs.reduce((a,x)=>a+selector(x),0);
 const kings=Object.fromEntries(Object.keys(runs[0].kings).map(name=>{
  const games=sum(x=>x.kings[name].games),wins=sum(x=>x.kings[name].wins);
  return [name,{games,wins,rate:rate(wins,games)}];
 }));
 const seat=Object.fromEntries(Array.from({length:scenario.players},(_,i)=>String(i+1)).map(k=>{
  const games=sum(x=>x.seats[k].games),wins=sum(x=>x.seats[k].wins);
  return [k,{games,wins,rate:rate(wins,games)}];
 }));
 const spells={};
 for(const r of runs)for(const [spell,c] of Object.entries(r.telemetry.spells)){
  spells[spell]??={uses:0,observableChanges:0};
  spells[spell].uses+=c;
  spells[spell].observableChanges+=r.telemetry.spellsEffective[spell]||0;
 }
 for(const v of Object.values(spells))v.observedChangeRate=rate(v.observableChanges,v.uses);
 const crisisGames=sum(x=>x.resultMetrics.completedMatchesWithCriticalPlayer);
 const crisisWins=sum(x=>x.resultMetrics.criticalComebackWins);
 out.push({id:scenario.id,players:scenario.players,difficulty:scenario.difficulty,games:matches*seeds.length,
  finished:sum(x=>x.finished),averageTurns:+(runs.reduce((a,x)=>a+x.averageTurns,0)/runs.length).toFixed(2),
  seat,kings,criticalComeback:{eligibleMatches:crisisGames,wins:crisisWins,rate:rate(crisisWins,crisisGames)},spells,
  observedUnitTrades:sum(x=>x.telemetry.mutualKills),kingDamage:sum(x=>x.telemetry.kingDamage)});
 console.error("BALANCE",scenario.id,"finished",out.at(-1).finished);
}
console.log(JSON.stringify({source:"simulated",rules:"current PR #5 candidate only",seeds,matchesPerSeed:matches,out},null,2));
