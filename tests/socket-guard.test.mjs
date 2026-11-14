import {test} from "node:test";
import assert from "node:assert/strict";
import {makeSocketGuard} from "../server/socket-guard.js";
test("accepts ordinary legal actions while rejecting malformed and oversized messages",()=>{
 const guard=makeSocketGuard({now:()=>1000});
 assert.equal(guard(["game:deploy",{cardId:"unit"},()=>{}]).ok,true);
 assert.equal(guard(["game:deploy",null,()=>{}]).ok,true);
 assert.equal(guard(["game:deploy",["array"],()=>{}]).ok,false);
 assert.equal(guard(["room:join","code",()=>{}]).ok,false);
 assert.equal(guard(["room:create",{name:"X".repeat(6000)}]).ok,false);
 assert.equal(guard(["room:create",{name:"Normal"}]).ok,true);
});
test("rate limits only repeated client-origin bursts and resets after interval",()=>{
 let ms=500;
 const guard=makeSocketGuard({now:()=>ms,controlMax:2,gameMax:3,controlWindowMs:1000,gameWindowMs:1000});
 assert.equal(guard(["game:deploy",{}]).ok,true);
 assert.equal(guard(["game:attackUnit",{}]).ok,true);
 assert.equal(guard(["game:endTurn",{}]).ok,true);
 assert.equal(guard(["game:castMagic",{}]).ok,false);
 assert.equal(guard(["room:create",{}]).ok,true);
 assert.equal(guard(["room:join",{}]).ok,true);
 assert.equal(guard(["room:resume",{}]).ok,false);
 ms=1500;
 assert.equal(guard(["game:endTurn",{}]).ok,true);
 assert.equal(guard(["room:resume",{}]).ok,true);
});
