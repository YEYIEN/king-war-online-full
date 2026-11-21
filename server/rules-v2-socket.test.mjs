import test from 'node:test';
import assert from 'node:assert/strict';
import {registerV2Playtest} from './v2-playtest-socket.mjs';
class FakeSocket {
 constructor(id){this.id=id;this.handlers=new Map();this.messages=[]}
 on(e,fn){this.handlers.set(e,fn)}
 join(){}
 emit(e,payload){this.messages.push({event:e,payload})}
 send(e,data={}){let result;const fn=this.handlers.get(e);assert.ok(fn,'missing '+e);fn(data,r=>result=r);assert.ok(result,'missing ack '+e);return result}
}
function setup(){
 const sockets=new Map(),nsp={on(e,fn){if(e==='connection')this.connect=fn},to(id){return {emit(e,payload){sockets.get(id)?.emit(e,payload)}}}};
 registerV2Playtest({of(name){assert.equal(name,'/v2-playtest');return nsp}});
 const connect=id=>{const s=new FakeSocket(id);sockets.set(id,s);nsp.connect(s);return s};
 return {connect};
}
const state=s=>s.messages.filter(m=>m.event==='v2:state').at(-1)?.payload;
const end=(s,code)=>{
 const p=s.send('v2:preview-end',{code});assert.equal(p.ok,true,p.error);
 const qinBottomIndex=p.qin&&p.drawn.length===3?2:null;
 const count=p.drawn.length-(qinBottomIndex===null?0:1);
 const excess=Math.max(0,p.hand.length+count-5);
 return s.send('v2:end',{code,qinBottomIndex,overflowDiscardIndices:Array.from({length:excess},(_,i)=>i)});
};
test('socket two-player room, five-card private hands, deployment and turn rotation',()=>{
 const {connect}=setup(),a=connect('A'),b=connect('B'),created=a.send('v2:create',{name:'甲'}),code=created.code;
 assert.equal(created.ok,true);assert.equal(b.send('v2:join',{code,name:'乙'}).ok,true);
 assert.equal(a.send('v2:start',{code}).ok,true);
 assert.equal(state(a).players[0].hand.length,5);
 assert.equal(state(b).players[0].hand,undefined);
 assert.equal(a.send('v2:deploy',{code,index:0}).ok,true);
 assert.equal(a.send('v2:attack',{code,attackerIndex:0,defenderPlayerIndex:1}).ok,false);
 assert.equal(end(a,code).ok,true);assert.equal(state(a).current,1);
 assert.equal(b.send('v2:deploy',{code,index:0}).ok,true);
 assert.equal(end(b,code).ok,true);assert.equal(state(a).current,0);
 assert.equal(a.send('v2:end',{code}).ok,false,'overflow selection must be explicit');
 assert.equal(a.send('v2:attack',{code,attackerIndex:0,defenderPlayerIndex:0}).ok,false);
});
test('Louis and Genghis abilities obey king selection, timing, and once-per-turn limits',()=>{
 const {connect}=setup(),a=connect('louis'),b=connect('genghis');
 const code=a.send('v2:create',{king:'路易十四'}).code;
 assert.equal(b.send('v2:join',{code,king:'成吉思汗'}).ok,true);
 assert.equal(a.send('v2:start',{code}).ok,true);
 assert.equal(a.send('v2:ability',{code,fieldIndex:0}).ok,false);
 assert.equal(a.send('v2:deploy',{code,index:0}).ok,true);
 assert.equal(a.send('v2:ability',{code,fieldIndex:0}).ok,false);
 assert.equal(end(a,code).ok,true);
 assert.equal(b.send('v2:ability',{code,fieldIndex:0,handIndex:0}).ok,false);
 assert.equal(b.send('v2:deploy',{code,index:0}).ok,true);
 assert.equal(b.send('v2:ability',{code,fieldIndex:0,handIndex:0}).ok,true);
 assert.equal(state(b).players[1].abilityUsed,true);
 assert.equal(b.send('v2:ability',{code,fieldIndex:0,handIndex:0}).ok,false);
 assert.equal(end(b,code).ok,true);
 assert.equal(a.send('v2:ability',{code,fieldIndex:0}).ok,true);
 assert.equal(state(a).players[0].field.length,0);
});
test('invalid kings and duplicate participants cannot join two rooms',()=>{
 const {connect}=setup(),a=connect('a'),b=connect('b');
 assert.equal(a.send('v2:create',{king:'unknown'}).ok,false);
 const code=a.send('v2:create',{king:'秦始皇'}).code;
 assert.equal(a.send('v2:join',{code}).ok,false);
 assert.equal(b.send('v2:join',{code,king:'亞歷山大大帝'}).ok,true);
 assert.equal(b.send('v2:join',{code}).ok,false);
 assert.equal(a.send('v2:start',{code}).ok,true);
 assert.equal(state(a).players[0].king,'秦始皇');
 assert.equal(state(b).players[0].hand,undefined);
});
test('Qin end preview is private and exactly one of three new cards returns to deck bottom',()=>{
 const {connect}=setup(),a=connect('qin'),b=connect('other');
 const code=a.send('v2:create',{king:'秦始皇'}).code;
 assert.equal(b.send('v2:join',{code}).ok,true);assert.equal(a.send('v2:start',{code}).ok,true);
 const before=JSON.stringify(state(a)),p=a.send('v2:preview-end',{code});
 assert.equal(p.ok,true);assert.equal(p.drawn.length,3);
 assert.equal(JSON.stringify(state(a)),before,'preview must not mutate state');
 assert.equal(b.send('v2:preview-end',{code}).ok,false);
 assert.equal(a.send('v2:end',{code,qinBottomIndex:3,overflowDiscardIndices:[0,1]}).ok,false);
 const chosen=2,kept=p.drawn.filter((_,i)=>i!==chosen),combined=[...p.hand,...kept];
 assert.equal(a.send('v2:end',{code,qinBottomIndex:chosen,overflowDiscardIndices:[0,1]}).ok,true);
 assert.deepEqual(state(a).players[0].hand,combined.slice(2));
 assert.equal(state(b).players[0].hand,undefined);
});
test('Qin preview after deploy and overflow choices use the new 5-card rule',()=>{
 const {connect}=setup(),a=connect('qin2'),b=connect('other2'),code=a.send('v2:create',{king:'秦始皇'}).code;
 assert.equal(b.send('v2:join',{code}).ok,true);assert.equal(a.send('v2:start',{code}).ok,true);
 assert.equal(a.send('v2:deploy',{code,index:0}).ok,true);
 const p=a.send('v2:preview-end',{code});assert.equal(p.ok,true);assert.equal(p.hand.length,4);
 assert.equal(p.drawn.length,3);
 const combined=[...p.hand,p.drawn[0],p.drawn[1]];
 assert.equal(a.send('v2:end',{code,qinBottomIndex:2,overflowDiscardIndices:[0]}).ok,true);
 assert.deepEqual(state(a).players[0].hand,combined.slice(1));
});
test('invalid requests reject without mutating player state',()=>{
 const {connect}=setup(),a=connect('invalidA'),b=connect('invalidB'),code=a.send('v2:create',{}).code;
 assert.equal(b.send('v2:join',{code}).ok,true);assert.equal(a.send('v2:start',{code}).ok,true);
 const before=JSON.stringify(state(a));
 for(const event of [{name:'v2:deploy',data:{index:'0'}},{name:'v2:deploy',data:{index:null}},{name:'v2:end',data:{overflowDiscardIndices:['0']}},{name:'v2:cast',data:{magicIndex:0,mageIndex:0,targetIndices:[0],defenderPlayerIndex:1}}]){
  assert.equal(a.send(event.name,{code,...event.data}).ok,false,event.name);
 }
 assert.equal(JSON.stringify(state(a)),before);
});
test('socket cannot create a second waiting room',()=>{
 const {connect}=setup(),a=connect('double'),first=a.send('v2:create',{name:'First'});
 assert.equal(first.ok,true);assert.equal(a.send('v2:create',{name:'Again'}).ok,false);
 assert.equal(state(a).code,first.code);
});
