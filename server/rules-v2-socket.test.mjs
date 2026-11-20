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
test('socket two-player flow: room, join, start, deploy, alternating turns, victory',async()=>{
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
 const firstTarget=state(a).players[1].field.some(u=>u.type==='步兵')&&state(a).players[0].field[0].type!=='弓兵'?{defenderIndex:0}:{};
 assert.equal((await a.send('v2:attack',{code,attackerIndex:0,...firstTarget})).ok,true);
 assert.equal((await a.send('v2:end',{code})).ok,true);
 const secondTarget=state(b).players[0].field.some(u=>u.type==='步兵')&&state(b).players[1].field[0].type!=='弓兵'?{defenderIndex:0}:{};
 assert.equal((await b.send('v2:attack',{code,attackerIndex:0,...secondTarget})).ok,true);
 let count=0;while(state(a).status==='playing'&&count++<100){
   const current=state(a).current,s=current===0?a:b;
   const p=state(s).players[current];
   if(p.field.length===0&&p.hand.length)assert.equal((await s.send('v2:deploy',{code,index:0})).ok,true);
   const currentState=state(s),currentP=currentState.players[current];
   for(let i=0;i<currentP.field.length;i++){if(currentP.field[i].tapped||currentP.field[i].justDeployed)continue;const enemy=currentState.players[1-current];const guarded=enemy.field.some(u=>u.type==='步兵')&&currentP.field[i].type!=='弓兵';const result=await s.send('v2:attack',{code,attackerIndex:i,...(guarded?{defenderIndex:enemy.field.findIndex(u=>u.type==='步兵')}: {})});assert.equal(result.ok,true);if(state(s).status==='finished')break}
   if(state(s).status==='playing')assert.equal((await s.send('v2:end',{code})).ok,true);
 }
 assert.equal(state(a).status,'finished','match must finish');
 assert.ok(['甲','乙'].includes(state(a).winner));
 assert.ok(state(a).players.some(p=>p.hp===0));
 assert.equal((await b.send('v2:end',{code})).ok,false,'finished match must reject turns');
});
