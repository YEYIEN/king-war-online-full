import test from "node:test";
import assert from "node:assert/strict";
import {applyPublicAttackStep,replayPublicAttackSteps} from "../server/public-combat-replay.js";

const counters={步兵:"弓兵",弓兵:"法師",法師:"騎兵",騎兵:"步兵"};
const unit=(id,type,rank="初級",extra={})=>({
 id,type,rank,counterTarget:counters[type],status:[],
 damage:rank==="高級"?5:rank==="中級"?3:1,tapped:false,
 archerBonusUsed:false,...extra
});
const make=(mine,theirs,options={})=>({
 own:{id:"me",field:mine},opponents:[{
  id:"op",hp:options.hp??20,field:theirs,eliminated:false,
  lastStandShield:options.shield??0
 }]
});
test("illegal actions do not alter the public snapshot",()=>{
 const state=make([unit("a","騎兵")],[unit("g","步兵")]);
 const before=JSON.stringify(state);
 assert.equal(applyPublicAttackStep(state,{type:"king",enemyId:"op",attackerId:"a"}).ok,false);
 assert.equal(applyPublicAttackStep(state,{type:"unit",enemyId:"op",attackerId:"a",defenderId:"missing"}).ok,false);
 assert.equal(JSON.stringify(state),before);
});
test("two-step archer attacks replay deterministically without mutating source",()=>{
 const state=make([unit("archer","弓兵","高級")],[
  unit("first","法師","初級"),unit("second","騎兵","初級")
 ]);
 const actions=[
  {type:"unit",enemyId:"op",attackerId:"archer",defenderId:"first"},
  {type:"unit",enemyId:"op",attackerId:"archer",defenderId:"second"}
 ];
 const snapshot=JSON.stringify(state);
 const result=replayPublicAttackSteps(state,actions);
 assert.equal(result.ok,true);
 assert.equal(result.events[0].archerExtra,true);
 assert.equal(result.state.own.field[0].tapped,true);
 assert.deepEqual(result.state.opponents[0].field,[]);
 assert.equal(JSON.stringify(state),snapshot);
 assert.deepEqual(replayPublicAttackSteps(state,actions),result);
});
test("blocked archer survives a stronger defender but gains fatigue",()=>{
 const state=make([unit("archer","弓兵","初級")],[unit("tank","騎兵","高級")]);
 const result=applyPublicAttackStep(state,{type:"unit",enemyId:"op",attackerId:"archer",defenderId:"tank"});
 assert.equal(result.ok,true);
 assert.equal(result.event.archerSaved,true);
 assert.equal(result.state.own.field.length,1);
 assert.equal(result.state.own.field[0].status.includes("疲乏"),true);
});
test("guard removal enables next king strike and shield consumes on cloned state",()=>{
 const state=make([unit("a","騎兵","高級"),unit("b","騎兵","中級")],[
  unit("guard","步兵","初級")
 ],{hp:6,shield:4});
 const moves=[
  {type:"unit",enemyId:"op",attackerId:"a",defenderId:"guard"},
  {type:"king",enemyId:"op",attackerId:"b"}
 ];
 const result=replayPublicAttackSteps(state,moves);
 assert.equal(result.ok,true);
 assert.equal(result.events[1].damage,1);
 assert.equal(result.state.opponents[0].hp,5);
 assert.equal(result.state.opponents[0].lastStandShield,2);
 assert.equal(state.opponents[0].lastStandShield,4);
});
