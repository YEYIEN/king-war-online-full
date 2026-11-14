import test from "node:test";
import assert from "node:assert/strict";
import {chooseRationalAttack,firstPlaceUtility} from "../server/ai-rational-planner.js";
import {listPublicAttackCandidates} from "../server/ai-legal-actions.js";
const ctr={步兵:"弓兵",弓兵:"法師",法師:"騎兵",騎兵:"步兵"};
const u=(id,type="騎兵",rank="中級",extra={})=>({
 id,type,rank,damage:rank==="高級"?5:rank==="中級"?3:1,
 counterTarget:ctr[type],tapped:false,status:[],archerBonusUsed:false,...extra
});
const p=(id,king,field=[],hp=20)=>({
 id,king:{name:king},hp,eliminated:false,magicCount:0,field
});
const eligible=(self,enemies)=>listPublicAttackCandidates(self.field,enemies).map(a=>({
 ...a,enemy:enemies.find(e=>e.id===a.enemyId),score:12
}));
test("rational search selects legal winning king strike without reading hidden opponent cards",()=>{
 const self=p("me","亞歷山大大帝",[u("s","騎兵","高級")],25);
 const opponent=p("other","秦始皇",[],4);
 Object.defineProperties(opponent,{
  hand:{get(){throw Error("hidden enemy hand accessed");}},
  magic:{get(){throw Error("hidden enemy magic accessed");}},
  resumeToken:{get(){throw Error("private token accessed");}}
 });
 const actions=eligible(self,[opponent]);
 const move=chooseRationalAttack(actions,{self,enemies:[opponent],maxNodes:500});
 assert.equal(move?.type,"king");
 assert.equal(move?.enemy.id,"other");
 assert.equal(move?.attackerId,"s");
 assert.ok(move?.rationalNodes<=500);
});
test("search leaves all input state intact and respects bounded search nodes",()=>{
 const self=p("me","屋大維奧古斯都",[
  u("a","騎兵","中級"),u("b","弓兵","高級"),u("g","步兵","初級")
 ],23);
 const enemies=[
  p("p2","路易十四",[u("guard","步兵"),u("mage","法師")],23),
  p("p3","秦始皇",[u("horse","騎兵")],14),
  p("p4","成吉思汗",[],10)
 ];
 const actions=eligible(self,enemies);
 const before=JSON.stringify({self,enemies,actions});
 const chosen=chooseRationalAttack(actions,{self,enemies,maxNodes:120,ownDepth:4,rootWidth:20});
 assert.equal(JSON.stringify({self,enemies,actions}),before);
 assert.ok(chosen===null||actions.some(a=>a.type===chosen.type&&a.attackerId===chosen.attackerId&&a.enemy.id===chosen.enemy.id));
 assert.ok((chosen?.rationalNodes??0)<=120);
});
test("eliminating final opponent has greater utility than trading for material",()=>{
 const mine=p("mine","秦始皇",[u("unit")],20);
 const alone=p("enemy","成吉思汗",[],3);
 const state={own:mine,opponents:[alone]};
 const before=firstPlaceUtility(state,mine.id);
 const after=firstPlaceUtility({
  own:mine,opponents:[{...alone,hp:-2,eliminated:true}]
 },mine.id);
 assert.ok(after>before+1000);
});
test("no legal attacks are passed rather than fabricated",()=>{
 const self=p("me","路易十四",[u("guard","步兵","初級",{status:["疲乏"]})],20);
 const enemy=p("other","秦始皇",[],20);
 assert.equal(chooseRationalAttack([], {self,enemies:[enemy]}),null);
});
