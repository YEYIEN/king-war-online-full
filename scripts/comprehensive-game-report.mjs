import assert from "node:assert/strict";
import { simulateKingBaseline } from "../server/index.js";

const seeds = [104729, 130363, 196613];
const mainMatches = Number(process.env.MAIN_MATCHES_PER_SEED || 400);
const easyMatches = Number(process.env.EASY_MATCHES_PER_SEED || 200);
const abMatches = Number(process.env.AB_MATCHES_PER_SEED || 200);
const maxTurns = 180;
const settings = [];
for (const players of [2,3,4,5]) {
  for (const difficulty of ["easy","normal","hard"]) {
    settings.push({name:`${players}p/${difficulty}/optimized`,players,difficulty,
      count:difficulty==="easy"?easyMatches:mainMatches, comebackEnabled:true,comebackPolicy:"situational"});
  }
  settings.push({name:`${players}p/hard/legacy-comeback`,players,difficulty:"hard",
    count:abMatches, comebackEnabled:true, comebackPolicy:"legacy"});
  settings.push({name:`${players}p/hard/no-comeback`,players,difficulty:"hard",
    count:abMatches, comebackEnabled:false, comebackPolicy:"situational"});
}
settings.push({name:"2p/hard/fair-opening",players:2,difficulty:"hard",count:abMatches,
  comebackEnabled:true,comebackPolicy:"situational",firstSeatPeacefulTurn:true,secondSeatExtraCards:1});

function wilson(wins,total) {
  if (!total) return [0,0];
  const z=1.96,p=wins/total,z2=z*z,denom=1+z2/total;
  const mid=(p+z2/(2*total))/denom;
  const margin=z*Math.sqrt(p*(1-p)/total+z2/(4*total*total))/denom;
  return [+(100*(mid-margin)).toFixed(2),+(100*(mid+margin)).toFixed(2)];
}
function pct(a,b) {return b?+(100*a/b).toFixed(2):0;}
function quantile(data,q) {
  if(!data.length)return null;
  const ordered=[...data].sort((a,b)=>a-b);
  const idx=(ordered.length-1)*q,lo=Math.floor(idx),hi=Math.ceil(idx);
  return +(ordered[lo]+(ordered[hi]-ordered[lo])*(idx-lo)).toFixed(2);
}
const output=[];
for(const setting of settings){
  const runs=[];
  for(const seed of seeds){
    const run=await simulateKingBaseline({
      seed,matches:setting.count,playerCount:setting.players,difficulty:setting.difficulty,
      maxTurns,includeTurnSamples:true, comebackEnabled:setting.comebackEnabled,
      comebackPolicy:setting.comebackPolicy,firstSeatPeacefulTurn:!!setting.firstSeatPeacefulTurn,
      secondSeatExtraCards:setting.secondSeatExtraCards||0
    });
    assert.deepEqual(run.invariantViolations,{},`state integrity failed in ${setting.name}, seed ${seed}`);
    assert.equal(run.finished+run.unfinished,setting.count);
    assert.equal(Object.values(run.kings).reduce((v,k)=>v+k.wins,0),run.finished);
    runs.push(run);
  }
  const sum=fn=>runs.reduce((acc,r)=>acc+fn(r),0);
  const turns=runs.flatMap(r=>r.turnSamples);
  const total=turns.length,finished=sum(r=>r.finished);
  const kingNames=Object.keys(runs[0].kings);
  const kings=Object.fromEntries(kingNames.map(k=>{
    const games=sum(r=>r.kings[k].games),wins=sum(r=>r.kings[k].wins);
    return [k,{games,wins,winRate:pct(wins,games),wilson95:wilson(wins,games)}];
  }));
  const seats=Object.fromEntries(Object.keys(runs[0].seats).map(k=>{
    const games=sum(r=>r.seats[k].games),wins=sum(r=>r.seats[k].wins);
    return [k,{games,wins,winRate:pct(wins,games),wilson95:wilson(wins,games)}];
  }));
  const trailingGames=sum(r=>r.resultMetrics.completedMatchesWithTrailingPlayer);
  const comebackWins=sum(r=>r.resultMetrics.actualComebackWins);
  const individualTrailing=sum(r=>r.resultMetrics.potentialComebackPlayers);
  const mean=turns.reduce((a,v)=>a+v,0)/turns.length;
  const row={
    name:setting.name,players:setting.players,difficulty:setting.difficulty,
    settings:{comebackEnabled:setting.comebackEnabled,comebackPolicy:setting.comebackPolicy,
      fairOpening:!!setting.firstSeatPeacefulTurn},
    games:total,completed:finished,unfinished:total-finished,
    unfinishedReasons:Object.fromEntries(Object.keys(runs[0].unfinishedReasons).map(k=>[k,sum(r=>r.unfinishedReasons[k])])),
    kingWinRates:kings,seatWinRates:seats,
    turns:{mean:+mean.toFixed(2),p10:quantile(turns,.10),median:quantile(turns,.5),
      p90:quantile(turns,.9),max:Math.max(...turns)},
    durationMinutes:{
      assumption:"30/60/90 seconds per active-player turn; excludes matchmaking, breaks, discussion and device delay",
      short:+(mean*30/60).toFixed(1),central:+(mean*60/60).toFixed(1),long:+(mean*90/60).toFixed(1),
      p90Central:+(quantile(turns,.9)*60/60).toFixed(1)
    },
    comeback:{
      criticalQualifiedGames:sum(r=>r.resultMetrics.completedMatchesWithCriticalPlayer),
      criticalComebackWins:sum(r=>r.resultMetrics.criticalComebackWins),
      criticalComebackRateConditional:pct(sum(r=>r.resultMetrics.criticalComebackWins),sum(r=>r.resultMetrics.completedMatchesWithCriticalPlayer)),
      criticalPlayerInstances:sum(r=>r.resultMetrics.criticalPlayerInstances),
      criticalPlayerWinConversion:pct(sum(r=>r.resultMetrics.criticalComebackWins),sum(r=>r.resultMetrics.criticalPlayerInstances)),
      qualifyingCompletedGames:trailingGames,
      eligibleShareOfCompletedMatches:pct(trailingGames,finished),
      realComebackWins:comebackWins,
      comebackShareOfAllCompleted:pct(comebackWins,finished),
      realComebackRateConditional:pct(comebackWins,trailingGames),
      distinctTrailingPlayers:individualTrailing,
      trailingPlayerWinRate:pct(comebackWins,individualTrailing),
      realComebackWinsUsingLastStand:sum(r=>r.resultMetrics.comebackWinsUsingLastStand),
      realComebackWinsWithoutLastStand:sum(r=>r.resultMetrics.comebackWinsWithoutLastStand),
      lastStandAssaultUses:sum(r=>r.comebackUse.assault),
      lastStandDefenseUses:sum(r=>r.comebackUse.defense)
    },
    events:{
      unitAttacks:sum(r=>r.telemetry.unitAttacks),
      kingAttacks:sum(r=>r.telemetry.kingAttacks),
      totalKingDamage:sum(r=>r.telemetry.kingDamage),
      spells:sum(r=>Object.values(r.telemetry.spells).reduce((a,b)=>a+b,0)),
      mongolRecalls:sum(r=>r.telemetry.mongolRecalls)
    },
    bySeed:runs.map(r=>({seed:r.seed,completed:r.finished,comebackWins:r.resultMetrics.actualComebackWins,
      firstSeatWins:r.seats["1"].wins,kings:Object.fromEntries(Object.entries(r.kings).map(([k,v])=>[k,{games:v.games,wins:v.wins}]))}))
  };
  output.push(row);
  console.error(`OK ${row.name}: ${row.completed}/${total} finished; comeback ${row.comeback.realComebackRateConditional}%`);
}
console.log(JSON.stringify({version:1,methodology:"Actual server rules + AI-only seeded simulations; severe deficit observed at start of own turn after first full rotation: HP<=20 and >=8 HP behind max opponent OR >=3 HP and >=3 field units behind; critical deficit observed after TWO full rotations: HP<=12, opponent at least 12 HP higher and at least 1 more field unit; only a final victory after the recorded deficit counts as comeback; 60s per player action turn is an assumption, not observed human gameplay time.",seeds, maxTurns,settings:{mainMatches,easyMatches,abMatches},scenarioCount:output.length,scenarios:output},null,2));
