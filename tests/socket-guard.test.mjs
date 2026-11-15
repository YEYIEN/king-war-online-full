import { test } from "node:test";
import assert from "node:assert/strict";
import { createSocketEventGuard } from "../server/socket-guard.js";
function invoke(guard,event,data={}){
 let outcome;let called=0;
 guard([event,data,answer=>{outcome=answer}],()=>{called++});
 return {outcome,called};
}
test("guard does not touch normal legal player actions",()=>{
 let clock=0;const g=createSocketEventGuard({now:()=>clock});
 for(const event of ["game:deploy","game:attackUnit","game:castMagic","game:endTurn"]){
  const r=invoke(g,event,{cardId:"normal"});
  assert.equal(r.called,1,event);
 }
});
test("socket rejects very large action payloads before server rules are reached",()=>{
 const g=createSocketEventGuard();
 const r=invoke(g,"game:castMagic",{magicId:"m",extra:"x".repeat(13000)});
 assert.equal(r.called,0);
 assert.equal(r.outcome.ok,false);
});
test("socket rejects null, scalar, or array objects",()=>{
 const g=createSocketEventGuard();
 for(const payload of [null,1,"x",[],false]){
  const r=invoke(g,"game:deploy",payload);
  assert.equal(r.called,0);
  assert.equal(r.outcome.ok,false);
 }
});
test("separate per-socket event and join budgets reject abuse but reset with elapsed time",()=>{
 let now=100000;
 const g=createSocketEventGuard({now:()=>now});
 for(let i=0;i<24;i++)assert.equal(invoke(g,"room:create",{name:"tester"}).called,1);
 assert.equal(invoke(g,"room:create",{name:"tester"}).called,0);
 assert.equal(invoke(g,"game:deploy",{cardId:"c"}).called,1,"join flood must not block game actions");
 now+=61000;
 assert.equal(invoke(g,"room:create",{name:"tester"}).called,1);
 const h=createSocketEventGuard({now:()=>now});
 for(let i=0;i<180;i++)assert.equal(invoke(h,"game:deploy",{cardId:"x"}).called,1);
 assert.equal(invoke(h,"game:deploy",{cardId:"x"}).called,0);
 now+=11000;
 assert.equal(invoke(h,"game:deploy",{cardId:"x"}).called,1);
});
