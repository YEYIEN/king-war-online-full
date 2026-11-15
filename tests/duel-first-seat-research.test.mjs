import test from "node:test";
import assert from "node:assert/strict";
process.env.KW_SIMULATION="1";
const {simulateKingBaseline}=await import("../server/index.js");
const options={matches:12,seed:779021,playerCount:2,maxTurns:180,difficulty:"hard"};
const comparable=r=>({
 kings:r.kings,seats:r.seats,finished:r.finished,unfinished:r.unfinished,
 telemetry:r.telemetry,averageTurns:r.averageTurns,invariantViolations:r.invariantViolations
});
test("research-only first-seat flags are inert by default",async()=>{
 const base=await simulateKingBaseline(options);
 const zero=await simulateKingBaseline({...options,
  firstSeatOpeningHandPenalty:0,firstSeatInitialDrawPenalty:0,firstSeatInitialDeployLimit:null});
 assert.deepEqual(comparable(base),comparable(zero));
});
test("duel first-seat controls do not alter non-duel play",async()=>{
 const main={...options,playerCount:4};
 const base=await simulateKingBaseline(main);
 const candidate=await simulateKingBaseline({...main,
  firstSeatOpeningHandPenalty:2,firstSeatInitialDrawPenalty:1,firstSeatInitialDeployLimit:1});
 assert.deepEqual(comparable(base),comparable(candidate));
});
test("research opening compensation stays within normal state invariants",async()=>{
 const candidate=await simulateKingBaseline({...options,matches:36,
  firstSeatPeacefulTurn:true,secondSeatExtraCards:1,
  firstSeatOpeningHandPenalty:1,firstSeatInitialDrawPenalty:1,firstSeatInitialDeployLimit:1});
 assert.deepEqual(candidate.invariantViolations,{});
 assert.equal(candidate.finished+candidate.unfinished,36);
 assert.equal(candidate.unfinishedReasons.stalledAITurn,0);
});
