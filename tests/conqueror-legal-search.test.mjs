import test from "node:test";
import assert from "node:assert/strict";
import {selectAttackChoice,scorePublicEnemyThreat,publicOpponentForAI} from "../server/ai-strategies.js";
import {power,battle,canAttack,effectiveDamage} from "../server/combat-primitives.js";

const mk=(id,type="騎兵",rank="中級",status=[])=>({
 id,type,rank,counterTarget:({騎兵:"步兵",步兵:"弓兵",弓兵:"法師",法師:"騎兵"})[type],
 status,damage:rank==="中級"?3:rank==="高級"?5:1,tapped:false
});
test("Conqueror tactical search rejects fatigued and frozen attackers",()=>{
 for(const status of ["整備","不能攻擊","疲乏","疲乏待解"]){
  const actor=mk("a","騎兵","中級",[status]);
  const enemy={id:"op",hp:2,field:[],eliminated:false,magicCount:0};
  const choice=selectAttackChoice(
   [{type:"king",enemy,attackerId:"a",score:999}],
   {difficulty:"conqueror",self:{id:"self",hp:20,field:[actor]},enemies:[enemy],
    power,battle,canAttack,effectiveDamage,conquerorSearch:true,conquerorProfile:"resource"});
  assert.equal(choice,null,`status ${status} may not attack`);
 }
});
test("public threat uses only counts and visible battlefield, never hidden cards",()=>{
 const opponent={
  id:"enemy",hp:30,king:{name:"路易十四"},field:[mk("unit","法師")],
  magicCount:3,eliminated:false,
  get hand(){throw Error("private hand accessed");},
  get magic(){throw Error("private spells accessed");},
  get resumeToken(){throw Error("private token accessed");}
 };
 const visible=publicOpponentForAI(opponent);
 const score=scorePublicEnemyThreat(visible,{playerCount:4,difficulty:"hard"});
 assert.equal(Number.isFinite(score),true);
 assert.equal(visible.magicCount,3);
});
