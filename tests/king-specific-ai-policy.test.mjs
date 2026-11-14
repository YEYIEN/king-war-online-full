import test from "node:test";
import assert from "node:assert/strict";
import {
 scoreKingPlanDeployment,scoreKingPlanAttack,counterKingThreat,scoreKingCounterAttack,
 publicOpponentForAI
} from "../server/ai-strategies.js";
const kings=["亞歷山大大帝","屋大維奧古斯都","成吉思汗","秦始皇","路易十四"];
const unit=(id,type="騎兵",rank="中級")=>({
 id,type,rank,damage:rank==="高級"?5:rank==="中級"?3:1,
 counterTarget:({騎兵:"步兵",步兵:"弓兵",弓兵:"法師",法師:"騎兵"})[type],
 tapped:false,status:[],archerBonusUsed:false
});
test("each own king has a concrete different deploy preference, without changing legal rules",()=>{
 const hand=[unit("mage","法師"),unit("guard","步兵"),unit("horse","騎兵")];
 const enemy={king:{name:"亞歷山大大帝"},hp:30,magicCount:0,field:[unit("enemy","步兵")]};
 const kingPlan=[];
 for(const name of kings){
  const self={king:{name},hp:20,field:[],hand,magic:[],recallDrawCount:0};
  const scores=hand.map(card=>scoreKingPlanDeployment(card,self,enemy,"hard"));
  assert.ok(scores.some(x=>x>0),name);
  assert.deepEqual(hand.map(card=>scoreKingPlanDeployment(card,self,enemy,"normal")),[0,0,0]);
  kingPlan.push(scores.join(","));
 }
 assert.ok(new Set(kingPlan).size>=4);
});
test("conqueror counter scoring is public only and changes by enemy king",()=>{
 const attacker=unit("ours","騎兵");
 const enemyMage=unit("mage","法師");
 const enemyHorse=unit("horse","騎兵");
 const output=[];
 for(const name of kings){
  const opponent={id:name,king:{name},hp:26,field:[enemyMage,enemyHorse],magicCount:2,
    get hand(){throw Error("opponent hidden hand leaked");},
    get magic(){throw Error("opponent spell content leaked");},
    get resumeToken(){throw Error("opponent token leaked");}
  };
  const view=publicOpponentForAI(opponent);
  output.push(counterKingThreat(view)+scoreKingCounterAttack({enemy:view,defender:view.field[0],attacker}));
  assert.equal(typeof output.at(-1),"number");
  assert.equal(Object.hasOwn(view,"hand"),false);
 }
 assert.ok(new Set(output).size>=4);
});
test("own-king attack scores respond to kill, survival and mage protection",()=>{
 const defender=unit("enemy","步兵","初級");
 const attacker=unit("attacker","騎兵","高級");
 const enemy={hp:20,field:[defender],magicCount:1,king:{name:"秦始皇"}};
 const own=king=>({king:{name:king},hp:20,field:[attacker,unit("mage","法師")]});
 assert.ok(scoreKingPlanAttack({self:own("亞歷山大大帝"),enemy,attacker,defender})>0);
 const mage=unit("mage","法師");
 const ownLouis={king:{name:"路易十四"},hp:20,field:[mage]};
 assert.ok(scoreKingPlanAttack({self:ownLouis,enemy,attacker:mage,defender})<0);
});
