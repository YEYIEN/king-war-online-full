import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { createMatchMetrics, incrementMatchMetric, beginTurnMetrics, recordTurnDuration, buildMatchSummary,
  finalizeMatchMetrics, persistMatchSummary } from "../server/game-metrics.js";

function room(){
 const players=[
  {id:"SECRET_A",name:"PRIVATE Alice",isAI:false,king:{name:"亞歷山大大帝"},hp:12,eliminated:false},
  {id:"SECRET_B",name:"PRIVATE Bot",isAI:true,aiDifficulty:"hard",king:{name:"路易十四"},hp:0,eliminated:true}
 ];
 return {code:"SECRET_ROOM",players,turnsCompleted:11,settings:{aiDifficulty:"hard",resumeToken:"SECRET_TOKEN"}};
}
test("telemetry emits only anonymous balance dimensions and event counters",()=>{
 const x=room();x.matchMetrics=createMatchMetrics(x,1000);
 incrementMatchMetric(x,"unitAttack",1,{playerId:"SECRET_A"});
 incrementMatchMetric(x,"spellCast",1,{playerId:"SECRET_A",spell:"火球術",effective:true});
 incrementMatchMetric(x,"kingDamage",4,{playerId:"SECRET_A"});
 recordTurnDuration(x,36000);
 const summary=buildMatchSummary(x,{winnerId:"SECRET_A",now:70000,comeback:{comebackWin:true,criticalWin:false}});
 assert.equal(summary.winnerSeat,1);
 assert.equal(summary.winnerKing,"亞歷山大大帝");
 assert.equal(summary.turnDuration.samples,1);
 assert.equal(summary.events.kingDamage,4);
 assert.equal(summary.spellsEffective["火球術"],1);
 assert.equal(summary.seats[0].actions.unitAttack,1);
 const raw=JSON.stringify(summary);
 for(const secret of ["SECRET_A","SECRET_B","SECRET_ROOM","PRIVATE Alice","SECRET_TOKEN"])
   assert.ok(!raw.includes(secret),`private field leaked: ${secret}`);
});
test("telemetry cannot be finalized twice or persisted in simulation mode",async()=>{
 const x=room();x.matchMetrics=createMatchMetrics(x,1000);
 const summaries=[];
 const once=finalizeMatchMetrics(x,{winnerId:"SECRET_A",now:60000,persist:async s=>{summaries.push(s);return true}});
 const second=finalizeMatchMetrics(x,{winnerId:"SECRET_B",now:61000,persist:async s=>{summaries.push(s);return true}});
 assert.ok(once);
 assert.equal(second,null);
 await Promise.resolve();
 assert.equal(summaries.length,1);
 assert.equal(await persistMatchSummary(once,{simulation:true,filePath:"/tmp/should-never-write-kingwar.jsonl"}),false);
});
test("turn duration validates inputs and trims outliers",()=>{
 const x=room();x.matchMetrics=createMatchMetrics(x,0);
 recordTurnDuration(x,-1);recordTurnDuration(x,NaN);recordTurnDuration(x,99999999);
 const summary=buildMatchSummary(x,{winnerId:null,now:1});
 assert.equal(summary.turnDuration.samples,1);
 assert.equal(summary.turnDuration.meanMs,3600000);
 assert.equal(summary.winnerSeat,null);
});

test("live opt-in JSONL records persist and aggregate with safe completed denominators",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"kingwar-metrics-test-"));
 try{
  const filename=join(dir,"sessions.match-metrics.jsonl");
  const good=room();good.matchMetrics=createMatchMetrics(good,1000);
  recordTurnDuration(good,30000,{ai:false});
  recordTurnDuration(good,900,{ai:true});
  const completed=buildMatchSummary(good,{winnerId:"SECRET_A",now:61000,
   comeback:{trailingPlayers:1,criticalPlayers:1,comebackWin:true,criticalWin:true}});
  await persistMatchSummary(completed,{filePath:filename,simulation:false});
  const abandoned=buildMatchSummary(good,{winnerId:null,reason:"abandoned",now:62000});
  await persistMatchSummary(abandoned,{filePath:filename,simulation:false});
  const rows=(await readFile(filename,"utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(rows.length,2);
  assert.ok(!JSON.stringify(rows).includes("SECRET_A"));
  const cli=spawnSync(process.execPath,[new URL("../scripts/aggregate-match-metrics.mjs",import.meta.url).pathname,filename],{encoding:"utf8"});
  assert.equal(cli.status,0,cli.stderr);
  const report=JSON.parse(cli.stdout);
  assert.equal(report.groups.length,1);
  const group=report.groups[0];
  assert.equal(group.games,2);
  assert.equal(group.completed,1);
  assert.equal(group.king["亞歷山大大帝"].winRate,100);
  assert.equal(group.observedHumanTurnSeconds,30);
  assert.equal(group.observedAiTurnSeconds,0.9);
  assert.equal(group.comebackRate.critical,100);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test("quiet turn counts only turns without kills or damage",()=>{
 const r=room();r.matchMetrics=createMatchMetrics(r,1000);
 beginTurnMetrics(r,"SECRET_A");
 incrementMatchMetric(r,"deploy",1,{playerId:"SECRET_A"});
 recordTurnDuration(r,20000,{ai:false,playerId:"SECRET_A"});
 assert.equal(r.matchMetrics.events.quietCombatTurn,1);
 beginTurnMetrics(r,"SECRET_A");
 incrementMatchMetric(r,"unitKill",1,{playerId:"SECRET_A"});
 recordTurnDuration(r,15000,{ai:false,playerId:"SECRET_A"});
 assert.equal(r.matchMetrics.events.quietCombatTurn,1);
 assert.equal(r.matchMetrics.turnDuration,undefined);
 const summary=buildMatchSummary(r,{winnerId:"SECRET_A",now:50000});
 assert.equal(summary.seats[0].actions.quietCombatTurn,1);
});
