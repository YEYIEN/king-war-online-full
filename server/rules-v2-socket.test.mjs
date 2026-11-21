import test from 'node:test';import assert from 'node:assert/strict';
import {registerV2Playtest} from './v2-playtest-socket.mjs';
class FakeSocket {
 constructor(id){this.id=id;this.handlers=new Map();this.messages=[]}
 on(event,handler){this.handlers.set(event,handler)}
 join(){}
 emit(event,payload){this.messages.push({event,payload})}
 async send(event,data={}){let result;const handler=this.handlers.get(event);assert.ok(handler,'missing handler '+event);handler(data,r=>{result=r});assert.ok(result,'missing acknowledgement '+event);return result}
}
function setup(){const sockets=new Map(),nsp={on(event,handler){if(event==='connection')this.connect=handler},to(id){return {emit(event,payload){sockets.get(id)?.emit(event,payload)}}}};const io={of(name){assert.equal(name,'/v2-playtest');return nsp}};registerV2Playtest(io);const connect=id=>{const s=new FakeSocket(id);sockets.set(id,s);nsp.connect(s);return s};return {connect}}
const state=s=>s.messages.filter(m=>m.event==='v2:state').at(-1)?.payload;
test('socket two-player flow: room, join, start, deploy, alternating turns and guarded combat',async()=>{
 const {connect}=setup(),a=connect('A'),b=connect('B');
 const created=await a.send('v2:create',{name:'甲'});assert.equal(created.ok,true);const code=created.code;
 assert.equal((await b.send('v2:join',{code,name:'乙'})).ok,true);
 assert.equal((await a.send('v2:start',{code})).ok,true);
 assert.equal(state(a).players.length,2);assert.equal(state(b).players[0].hand,undefined,'opponent hand must be hidden');
 assert.equal(state(a).players[0].hand.length,3);
 assert.equal((await a.send('v2:deploy',{code,index:0})).ok,true);
 assert.equal((await a.send('v2:attack',{code,attackerIndex:0})).ok,false,'new unit cannot attack');
 assert.equal((await a.send('v2:end',{code})).ok,true);
 assert.equal((await b.send('v2:deploy',{code,index:0})).ok,true);
 assert.equal((await b.send('v2:end',{code})).ok,true);
 const p=state(a).players[0].field[0];assert.ok(p,'deployed unit exists');
 const opponent=state(a).players[1];const guarded=opponent.field.some(u=>u.type==='步兵')&&p.type!=='弓兵';
 const target=guarded?{defenderIndex:opponent.field.findIndex(u=>u.type==='步兵')}:{};
 assert.equal((await a.send('v2:attack',{code,attackerIndex:0,...target})).ok,true);
 assert.equal((await a.send('v2:end',{code})).ok,true);
 assert.equal(state(b).current,1);
 assert.equal((await a.send('v2:end',{code})).ok,false);
});
