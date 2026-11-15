import test from "node:test";
import assert from "node:assert/strict";
import {STRATEGY_ARCHETYPES,scoreArchetypeDeployment} from "../server/ai-strategies.js";
const player={field:[],hp:30,magic:[]};
const opponent={field:[{type:"步兵"}],hp:30};
const unit=(type,rank="初級",counterTarget="步兵")=>({type,rank,counterTarget});
test("research archetype list is stable and balanced baseline yields no score changes",()=>{
 assert.deepEqual(STRATEGY_ARCHETYPES,["balanced","rush","fortress","arcane","economy","counter"]);
 for(const type of ["步兵","騎兵","法師","弓兵"])
  assert.equal(scoreArchetypeDeployment(unit(type),player,opponent,"balanced"),0);
});
test("six research styles change only deployment ranking and do not mutate inputs",()=>{
 const before=JSON.stringify({player,opponent});
 assert.ok(scoreArchetypeDeployment(unit("騎兵"),player,opponent,"rush")>0);
 assert.ok(scoreArchetypeDeployment(unit("步兵"),player,opponent,"fortress")>0);
 assert.ok(scoreArchetypeDeployment(unit("法師"),player,opponent,"arcane")>0);
 assert.ok(scoreArchetypeDeployment(unit("騎兵","高級"),player,opponent,"economy")>0);
 assert.ok(scoreArchetypeDeployment(unit("騎兵","初級","步兵"),player,opponent,"counter")>0);
 assert.equal(JSON.stringify({player,opponent}),before);
 assert.throws(()=>scoreArchetypeDeployment(unit("騎兵"),player,opponent,"cheat"),/unknown strategy/);
});
