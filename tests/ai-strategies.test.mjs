import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_PROFILES, selectDeployChoice, selectAttackChoice, scoreTeachingDeployment, shouldUseMagicNow, chooseMongolRecall } from "../server/ai-strategies.js";

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

test("learning levels differ only in bot choices, not player actions or legal mechanics", () => {
 const self={hp:12,field:[],magic:[{name:"力量術"}]};
 const enemy={field:[{type:"步兵"}]};
 const low={type:"騎兵",rank:"初級"};
 const guard={type:"步兵",rank:"初級"};
 assert.ok(scoreTeachingDeployment(guard,self,enemy,"easy",20)>20);
 assert.ok(scoreTeachingDeployment(low,self,enemy,"easy",20)>20);
 assert.ok(scoreTeachingDeployment(guard,self,enemy,"hard",20)>scoreTeachingDeployment(guard,self,enemy,"normal",20));
 assert.equal(shouldUseMagicNow({difficulty:"normal",spell:{name:"力量術",target:"我方"},ai:self,enemy,value:60,hasReadyAlly:false}),false);
 assert.equal(shouldUseMagicNow({difficulty:"normal",spell:{name:"力量術",target:"我方"},ai:self,enemy,value:60,hasReadyAlly:true}),true);
 assert.equal(shouldUseMagicNow({difficulty:"normal",spell:{name:"火球術",target:"敵方"},ai:self,enemy,value:12}),false);
 assert.equal(shouldUseMagicNow({difficulty:"easy",spell:{name:"火球術",target:"敵方"},ai:self,enemy,value:12}),true);
});
test("conqueror and hard preserve own-card-only deployment inputs",()=>{
 const self={hp:20,field:[{id:"u",type:"步兵"}],magic:[]};
 const enemy={field:[{type:"步兵"}]};
 const card={type:"騎兵",rank:"中級"};
 const before=JSON.stringify({self,enemy,card});
 scoreTeachingDeployment(card,self,enemy,"hard",50);
 scoreTeachingDeployment(card,self,enemy,"conqueror",50);
 assert.equal(JSON.stringify({self,enemy,card}),before);
});

test("Mongol risk assessment chooses low-rank tapped cavalry and preserves defenses in crisis",()=>{
 const player={king:{name:"成吉思汗"},recallUsed:false,hand:[],recallDrawCount:0,hp:24,
  field:[{id:"a",type:"騎兵",rank:"高級",tapped:true},
    {id:"b",type:"騎兵",rank:"初級",tapped:true},
    {id:"c",type:"步兵",rank:"中級",tapped:false}]};
 const quiet=[{id:"enemy",hp:30,field:[],eliminated:false}];
 const options={self:player,opponents:quiet,difficulty:"hard",canAttack:u=>!u.tapped,
   maxHand:7,random:()=>0};
 assert.equal(chooseMongolRecall(options)?.id,"b");
 assert.equal(chooseMongolRecall({...options,self:{...player,hand:Array(7).fill({})}}),null);
 const crisis={...player,hp:6};
 const threat=[{id:"enemy",hp:24,eliminated:false,field:[{tapped:false},{tapped:false}]}];
 assert.equal(chooseMongolRecall({...options,self:crisis,opponents:threat}),null);
 assert.equal(chooseMongolRecall({...options,self:{...player,recallUsed:true}}),null);
});
