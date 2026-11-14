import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/** Read anonymous JSONL match records. Usage: node scripts/aggregate-match-metrics.mjs /path/to/matches.jsonl */
const filePath=process.argv[2];
if(!filePath) {
 console.error("Usage: node scripts/aggregate-match-metrics.mjs /absolute/path/to/matches.jsonl");
 process.exitCode=2;
} else {
 const groups=new Map();
 const invalid={count:0};
 const source=createInterface({input:createReadStream(filePath,{encoding:"utf8"}),crlfDelay:Infinity});
 for await(const line of source) {
  if(!line.trim())continue;
  let match;
  try{match=JSON.parse(line)}catch{invalid.count++;continue}
  if(match.schemaVersion!==1 || match.source!=="live" || !Array.isArray(match.seats)) {invalid.count++;continue}
  const groupKey=[match.mode,match.playerCount,match.aiDifficulty,match.rulesetId||"unversioned"].join("|");
  const group=groups.get(groupKey)||{
   mode:match.mode,playerCount:match.playerCount,aiDifficulty:match.aiDifficulty,
   rulesetId:match.rulesetId||"unversioned",games:0,completed:0,
   turnSum:0,elapsedMsSum:0,durationSamples:0,durationMeanMsSum:0,
   king:{},seat:{},spells:{},spellImpacts:{},events:{},
   comeback:{severeQualified:0,severeWins:0,criticalQualified:0,criticalWins:0},
   humanGames:0,aiGames:0
  };
  group.games++;
  if(match.winnerSeat!=null)group.completed++;
  group.turnSum+=Number(match.turnsCompleted)||0;
  group.elapsedMsSum+=Number(match.elapsedMs)||0;
  if(match.turnDuration?.meanMs!=null){
   group.durationSamples+=match.turnDuration.samples||0;
   group.durationMeanMsSum+=(match.turnDuration.meanMs||0)*(match.turnDuration.samples||0);
  }
  if(match.humanCount>0)group.humanGames++;
  if(match.aiCount>0)group.aiGames++;
  for(const seat of match.seats){
   const name=seat.king||"unknown";
   group.king[name]??={appearances:0,wins:0,eliminations:0};
   group.king[name].appearances++;
   if(seat.won)group.king[name].wins++;
   if(seat.eliminated)group.king[name].eliminations++;
   const slot=String(seat.seat);
   group.seat[slot]??={appearances:0,wins:0};
   group.seat[slot].appearances++;
   if(seat.won)group.seat[slot].wins++;
  }
  for(const [name,n] of Object.entries(match.events||{}))group.events[name]=(group.events[name]||0)+n;
  for(const [name,n] of Object.entries(match.spells||{}))group.spells[name]=(group.spells[name]||0)+n;
  for(const [name,n] of Object.entries(match.spellsEffective||{}))group.spellImpacts[name]=(group.spellImpacts[name]||0)+n;
  if(match.comeback?.severeQualified)group.comeback.severeQualified++;
  if(match.comeback?.severe)group.comeback.severeWins++;
  if(match.comeback?.criticalQualified)group.comeback.criticalQualified++;
  if(match.comeback?.critical)group.comeback.criticalWins++;
  groups.set(groupKey,group);
 }
 const out=[...groups.values()].map(g=>({
  ...g,
  averageTurns:+(g.turnSum/g.games).toFixed(2),
  averageElapsedMinutes:+(g.elapsedMsSum/g.games/60000).toFixed(2),
  observedAverageTurnSeconds:g.durationSamples?+(g.durationMeanMsSum/g.durationSamples/1000).toFixed(1):null,
  king:Object.fromEntries(Object.entries(g.king).map(([name,k])=>[name,{...k,winRate:+(100*k.wins/k.appearances).toFixed(2)}])),
  seat:Object.fromEntries(Object.entries(g.seat).map(([name,k])=>[name,{...k,winRate:+(100*k.wins/k.appearances).toFixed(2)}])),
  spellImpactRate:Object.fromEntries(Object.entries(g.spells).map(([spell,c])=>[spell,c?+(100*(g.spellImpacts[spell]||0)/c).toFixed(1):0])),
  comebackRate:{
   severe:g.comeback.severeQualified?+(100*g.comeback.severeWins/g.comeback.severeQualified).toFixed(2):null,
   critical:g.comeback.criticalQualified?+(100*g.comeback.criticalWins/g.comeback.criticalQualified).toFixed(2):null
  }
 }));
 console.log(JSON.stringify({source:"live",schemaVersion:1,groups:out,invalidRows:invalid.count},null,2));
}
