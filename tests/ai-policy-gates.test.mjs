import test from "node:test";
import assert from "node:assert/strict";
import {shouldUseKingAwarePolicy,shouldUseRationalConqueror} from "../server/ai-policy-gates.js";

test("Hard duel Alexander uses independently supported king plan by default",()=>{
 assert.equal(shouldUseKingAwarePolicy({difficulty:"hard",kingName:"亞歷山大大帝",playerCount:2}),true);
 assert.equal(shouldUseKingAwarePolicy({difficulty:"hard",kingName:"成吉思汗",playerCount:2}),false);
 assert.equal(shouldUseKingAwarePolicy({difficulty:"hard",kingName:"亞歷山大大帝",playerCount:4}),false);
 assert.equal(shouldUseKingAwarePolicy({difficulty:"hard",kingName:"亞歷山大大帝",playerCount:2,
  settings:{kingAwareHardAI:false}}),false);
 for(const kingName of ["亞歷山大大帝","屋大維奧古斯都","成吉思汗","秦始皇","路易十四"]){
  assert.equal(shouldUseKingAwarePolicy({difficulty:"hard",kingName,playerCount:4,
   settings:{kingAwareHardAI:true}}),true,`opt-in hard plan: ${kingName}`);
 }
});
test("Conqueror uses validated duel search, but not unproven multiplayer search",()=>{
 assert.equal(shouldUseRationalConqueror({difficulty:"conqueror",playerCount:2}),true);
 for(const n of [3,4,5])assert.equal(shouldUseRationalConqueror({difficulty:"conqueror",playerCount:n}),false);
 assert.equal(shouldUseRationalConqueror({difficulty:"hard",playerCount:2}),false);
 assert.equal(shouldUseRationalConqueror({difficulty:"conqueror",playerCount:2,
  settings:{rationalConquerorDuel:false}}),false);
});
test("simulation controls never inherit experimental defaults",()=>{
 assert.equal(shouldUseKingAwarePolicy({difficulty:"hard",kingName:"亞歷山大大帝",playerCount:2,simulation:true}),false);
 assert.equal(shouldUseRationalConqueror({difficulty:"conqueror",playerCount:2,simulation:true}),false);
 assert.equal(shouldUseKingAwarePolicy({difficulty:"hard",kingName:"路易十四",playerCount:4,
  simulation:true,experimental:true}),true);
 assert.equal(shouldUseRationalConqueror({difficulty:"conqueror",playerCount:5,
  simulation:true,experimental:true}),true);
});
