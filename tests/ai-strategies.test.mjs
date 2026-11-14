import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_PROFILES, selectDeployChoice, selectAttackChoice } from "../server/ai-strategies.js";

const troop=(id,type,rank,damage=3)=>({id,type,rank,damage,tapped:false,status:[]});
const deps={
 battle:(a,d)=>a.rank==="高級"?"attacker":a.rank==="中級"&&d.rank==="高級"?"defender":"both",
 power:u=>({"初級":1,"中級":2,"高級":3})[u.rank],
 canAttack:u=>!u.tapped,
 effectiveDamage:u=>u.damage
};
test("all four AI policies have explicit learning or win objectives",()=>{
 assert.deepEqual(Object.keys(AI_PROFILES),["easy","normal","hard","conqueror"]);
 assert.match(AI_PROFILES.easy.aim,/Learn/);
 assert.match(AI_PROFILES.conqueror.aim,/Maximize/);
});
test("easy deploy uses high-value shortlist but can select different reasonable cards",()=>{
 const scored=[{card:"A",score:80},{card:"B",score:70},{card:"C",score:50}];
 assert.equal(selectDeployChoice(scored,"easy",()=>0).card,"A");
 assert.equal(selectDeployChoice(scored,"easy",()=>0.99).card,"B");
 assert.equal(selectDeployChoice(scored,"hard").card,"A");
});
test("easy and medium avoid gratuitous loss of a weaker unit",()=>{
 const a=troop("a","騎兵","中級"),b=troop("b","步兵","高級");
 const self={id:"self",hp:30,field:[a]};
 const enemy={id:"enemy",hp:30,field:[b]};
 const result=selectAttackChoice([{enemy,attackerId:"a",defenderId:"b",type:"unit",score:80}],
  {difficulty:"normal",self,enemies:[enemy],...deps});
 assert.ok(result.expectedScore<0);
});
test("Conqueror prioritizes immediately lethal king attack over opportunistic unit removal",()=>{
 const a=troop("a","騎兵","中級",5),b=troop("b","弓兵","高級");
 const self={id:"self",hp:20,field:[a]};
 const enemy={id:"enemy",hp:4,field:[b]};
 const actions=[
  {enemy,attackerId:"a",defenderId:"b",type:"unit",score:95},
  {enemy,attackerId:"a",type:"king",score:20}
 ];
 const decision=selectAttackChoice(actions,{difficulty:"conqueror",self,enemies:[enemy],...deps});
 assert.equal(decision.type,"king");
});
test("Conqueror values clearing last infantry before other ready attackers finish the king",()=>{
 const a=troop("a","騎兵","高級"),c=troop("c","騎兵","中級",5);
 const self={id:"self",hp:22,field:[a,c]};
 const guard=troop("guard","步兵","初級");
 const mage=troop("mage","法師","初級");
 const enemy={id:"enemy",hp:5,field:[guard,mage]};
 const decision=selectAttackChoice([
  {enemy,attackerId:"a",defenderId:"mage",type:"unit",score:110},
  {enemy,attackerId:"a",defenderId:"guard",type:"unit",score:60}
 ],{difficulty:"conqueror",self,enemies:[enemy],...deps});
 assert.equal(decision.defenderId,"guard");
});
