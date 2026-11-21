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

test('selected kings and ability validation through socket',async()=>{
 const {connect}=setup(),a=connect('kingA'),b=connect('kingB');
 const c=(await a.send('v2:create',{name:'Louis',king:'路易十四'})).code;
 assert.equal((await b.send('v2:join',{code:c,name:'Genghis',king:'成吉思汗'})).ok,true);
 assert.equal((await a.send('v2:start',{code:c})).ok,true);
 assert.equal(state(a).players[0].king,'路易十四');
 assert.equal(state(b).players[1].king,'成吉思汗');
 assert.equal((await a.send('v2:ability',{code:c,fieldIndex:0})).ok,false,'cannot sacrifice absent unit');
 assert.equal((await a.send('v2:deploy',{code:c,index:0})).ok,true);
 assert.equal((await a.send('v2:ability',{code:c,fieldIndex:0})).ok,false,'cannot sacrifice freshly deployed unit');
 assert.equal((await a.send('v2:end',{code:c})).ok,true);
 assert.equal((await b.send('v2:ability',{code:c,fieldIndex:0,handIndex:0})).ok,false,'cannot swap without field unit');
 assert.equal((await b.send('v2:deploy',{code:c,index:0})).ok,true);
 assert.equal((await b.send('v2:ability',{code:c,fieldIndex:0,handIndex:0})).ok,true);
 assert.equal(state(b).players[1].abilityUsed,true);
 assert.equal((await b.send('v2:ability',{code:c,fieldIndex:0,handIndex:0})).ok,false);
});

test('room rejects duplicate participants and invalid king selections',async()=>{
 const {connect}=setup(),a=connect('duplicateA'),b=connect('duplicateB');
 assert.equal((await a.send('v2:create',{name:'A',king:'invalid'})).ok,false);
 const code=(await a.send('v2:create',{name:'A',king:'秦始皇'})).code;
 assert.equal((await a.send('v2:join',{code,name:'A2'})).ok,false);
 assert.equal((await b.send('v2:join',{code,name:'B',king:'亞歷山大大帝'})).ok,true);
 assert.equal((await b.send('v2:join',{code,name:'B2'})).ok,false);
 assert.equal((await a.send('v2:start',{code})).ok,true);
 assert.equal(state(a).players[0].king,'秦始皇');
 assert.equal(state(b).players[1].king,'亞歷山大大帝');
 assert.equal(state(b).players[0].hand,undefined);
});

test('Qin preview is private, does not mutate match, and matches selected end-turn hand',async()=>{
 const {connect}=setup(),a=connect('qinA'),b=connect('qinB');
 const code=(await a.send('v2:create',{king:'秦始皇'})).code;
 assert.equal((await b.send('v2:join',{code})).ok,true);
 assert.equal((await a.send('v2:start',{code})).ok,true);
 const before=JSON.stringify(state(a));
 const preview=await a.send('v2:preview-end',{code,discard:[]});
 assert.equal(preview.ok,true);
 assert.equal(JSON.stringify(state(a)),before);
 assert.equal((await b.send('v2:preview-end',{code})).ok,false);
 if(preview.hasExtra){
   assert.equal(preview.choices.length,4);
   assert.equal((await a.send('v2:end',{code,qinBottomIndex:3})).ok,true);
   assert.deepEqual(state(a).players[0].hand,preview.choices.slice(0,3));
 }else assert.equal((await a.send('v2:end',{code})).ok,true);
});
