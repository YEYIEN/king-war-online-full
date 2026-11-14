import test from "node:test";
import assert from "node:assert/strict";
import { simulateKingBaseline } from "../server/index.js";

const baseline={matches:18,seed:812081,playerCount:3,difficulty:"normal",maxTurns:180,comebackEnabled:true};
function withoutVariableTime(r){
  return {
    finished:r.finished,unfinished:r.unfinished,unfinishedReasons:r.unfinishedReasons,
    kings:r.kings,seats:r.seats,telemetry:r.telemetry,
    challengerStats:r.challengerStats,resultMetrics:r.resultMetrics,
    invariantViolations:r.invariantViolations,turnSamples:r.turnSamples
  };
}
test("simulated live rules are reproducible for identical seed and settings", async()=>{
  const first=await simulateKingBaseline({...baseline,includeTurnSamples:true});
  const second=await simulateKingBaseline({...baseline,includeTurnSamples:true});
  assert.deepEqual(withoutVariableTime(first),withoutVariableTime(second));
  assert.deepEqual(first.invariantViolations,{});
  assert.equal(first.finished+first.unfinished,baseline.matches);
});
test("AI tiers preserve legal state across player counts and difficulties", async()=>{
  for(const playerCount of [2,3,4,5]){
    for(const difficulty of ["easy","normal","hard","conqueror"]){
      const r=await simulateKingBaseline({matches:5,seed:104729,playerCount,difficulty,maxTurns:180,comebackEnabled:true});
      assert.deepEqual(r.invariantViolations,{},`${playerCount}/${difficulty}`);
      assert.equal(r.finished+r.unfinished,5);
      assert.equal(r.unfinishedReasons.stalledAITurn,0,`${playerCount}/${difficulty}: stalled AI`);
    }
  }
});
