import test from 'node:test';
import assert from 'node:assert/strict';
import {registerV2Playtest} from './v2-playtest-socket.mjs';

function setup({reconnectGraceMs=60000}={}){
 const sockets=new Map(),nsp={on(event,fn){if(event==='connection')this.connect=fn},to(id){return {emit(event,payload){sockets.get(id)?.messages.push({event,payload})}}}};
 registerV2Playtest({of(){return nsp}},{reconnectGraceMs});
 const connect=id=>{
  const handlers=new Map();
  const s={id,messages:[],on(e,fn){handlers.set(e,fn)},join(){},send(event,data={}){let answer;const fn=handlers.get(event);assert.ok(fn,event);fn(data,r=>answer=r);assert.ok(answer,'missing acknowledgement for '+event);return answer},disconnect(){handlers.get('disconnect')()}};
  sockets.set(id,s);nsp.connect(s);return s;
 };
 const state=s=>s.messages.filter(m=>m.event==='v2:state').at(-1)?.payload;
 const a=connect('a'),b=connect('b');
 const created=a.send('v2:create',{king:'亞歷山大大帝'}),code=created.code;
 assert.equal(created.ok,true);
 const joined=b.send('v2:join',{code,king:'屋大維奧古斯都'});
 assert.equal(joined.ok,true);
 assert.equal(a.send('v2:start',{code}).ok,true);
 return {a,b,connect,state,code,created,joined};
}
test('disconnected seat resumes with same hidden hand and rotating token',()=>{
 const {a,b,connect,state,code,joined}=setup();
 const before=state(b).players[1].hand.map(x=>x.id);
 b.disconnect();
 assert.equal(state(a).players[1].connected,false);
 assert.equal(state(a).players[1].hp,24,'temporary disconnect does not eliminate player');
 assert.equal(b.send('v2:deploy',{code,index:0}).ok,false,'disconnected socket may not act during grace');
 assert.equal(a.send('v2:resume',{code,resumeToken:joined.resumeToken}).ok,false,'connected player cannot claim another seat');
 const intruder=connect('attacker');
 assert.equal(intruder.send('v2:resume',{code,resumeToken:'0'.repeat(64)}).ok,false);
 assert.equal(state(a).players[1].hand,undefined,'seat private hand must remain private');
 const returned=connect('new-b');
 const resumed=returned.send('v2:resume',{code,resumeToken:joined.resumeToken});
 assert.equal(resumed.ok,true);
 assert.equal(resumed.resumeToken.length,64);
 assert.notEqual(resumed.resumeToken,joined.resumeToken);
 assert.equal(state(returned).you,1);
 assert.deepEqual(state(returned).players[1].hand.map(x=>x.id),before);
 assert.equal(state(a).players[1].hand,undefined);
 assert.equal(state(a).players[1].connected,true);
 assert.equal(intruder.send('v2:resume',{code,resumeToken:joined.resumeToken}).ok,false,'old token must be invalid');
 assert.equal(b.send('v2:deploy',{code,index:0}).ok,false,'old socket loses turn authority');
 const end=a.send('v2:end',{code,overflowDiscardIndices:[0,1]});
 assert.equal(end.ok,true,end.error);
 assert.equal(state(returned).current,1);
 assert.equal(returned.send('v2:deploy',{code,index:0}).ok,true);
});
test('attacker cannot reset interception budget by reconnecting',()=>{
 const {a,b,connect,state,code,created}=setup();
 assert.equal(a.send('v2:deploy',{code,index:0}).ok,true);
 assert.equal(a.send('v2:end',{code,overflowDiscardIndices:[0]}).ok,true);
 assert.equal(b.send('v2:end',{code,overflowDiscardIndices:[0,1]}).ok,true);
 assert.equal(a.send('v2:attack',{code,attackerIndex:0,defenderPlayerIndex:1}).ok,true);
 assert.equal(b.send('v2:respond-attack',{code,handIndex:0}).ok,true);
 assert.equal(state(b).players[1].interceptionUsedBy.a,true);
 a.disconnect();
 const resumed=connect('reconnected-a');
 assert.equal(resumed.send('v2:resume',{code,resumeToken:created.resumeToken}).ok,true);
 assert.equal(state(b).players[1].interceptionUsedBy['reconnected-a'],true);
 assert.equal(state(b).players[1].interceptionUsedBy.a,undefined);
});
test('expired disconnected player forfeits, releases cards and skips seat',async()=>{
 const {a,b,state,code}=setup({reconnectGraceMs:10});
 b.disconnect();
 assert.equal(state(a).players[1].hp,24);
 await new Promise(resolve=>setTimeout(resolve,35));
 assert.equal(state(a).players[1].hp,0);
 assert.equal(state(a).players[1].handCount,0);
 assert.equal(state(a).players[1].field.length,0);
 assert.equal(state(a).status,'finished');
});
test('waiting lobby requires all seats connected before starting',()=>{
 const {a,b,code,created}=(()=>{
  const sockets=new Map(),nsp={on(e,fn){if(e==='connection')this.connect=fn},to(id){return {emit(){}}}};
  registerV2Playtest({of(){return nsp}},{reconnectGraceMs:60000});
  const connect=id=>{const handlers={};const s={id,on(e,fn){handlers[e]=fn},join(){},send(e,d={}){let r;handlers[e](d,x=>r=x);return r},disconnect(){handlers.disconnect()}};sockets.set(id,s);nsp.connect(s);return s};
  const a=connect('wa'),b=connect('wb'),created=a.send('v2:create',{}),code=created.code;
  assert.equal(b.send('v2:join',{code}).ok,true);
  return {a,b,code,created};
 })();
 b.disconnect();
 assert.equal(a.send('v2:start',{code}).ok,false);
});
