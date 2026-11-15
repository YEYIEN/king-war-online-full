import test from "node:test";
import assert from "node:assert/strict";
import {scoreArchetypeAttack} from "../server/ai-strategies.js";
const unit=(type,id,rank="中級")=>({type,id,rank,damage:3,status:[],tapped:false,counterTarget:type==="騎兵"?"步兵":"弓兵"});
const enemy={id:"op",hp:20,field:[unit("步兵","g")]};
test("adversarial rush specifically pressures the last guard and king",()=>{
 const self={id:"self",hp:20,field:[unit("騎兵","c")]};
 const attacker=self.field[0];
 assert.ok(scoreArchetypeAttack({style:"rush",self,enemy,attacker,defender:enemy.field[0]})>0);
 assert.ok(scoreArchetypeAttack({style:"rush",self,enemy:{...enemy,field:[]},attacker,defender:null})>0);
 assert.equal(scoreArchetypeAttack({style:"balanced",self,enemy,attacker,defender:null}),0);
});
test("fortress discourages sacrificing sole guard and is deterministic",()=>{
 const self={id:"self",hp:10,field:[unit("步兵","p")]};
 const attacker=self.field[0];
 const value=scoreArchetypeAttack({style:"fortress",self,enemy,attacker,defender:enemy.field[0]});
 assert.ok(value<=-82);
 assert.equal(scoreArchetypeAttack({style:"fortress",self,enemy,attacker,defender:enemy.field[0]}),value);
 assert.throws(()=>scoreArchetypeAttack({style:"invalid",self,enemy,attacker,defender:null}),/unknown strategy/);
});
