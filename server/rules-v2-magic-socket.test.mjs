import test from 'node:test';
import assert from 'node:assert/strict';
import {registerV2Playtest} from './v2-playtest-socket.mjs';
import {MAGIC_DEFS} from './rules-v2-magic.mjs';

function fixture({kingA='亞歷山大大帝'}={}){
 const sockets=new Map();
 const nsp={on(e,fn){if(e==='connection')this.connect=fn},to(id){return {emit(e,data){sockets.get(id)?.messages.push({event:e,data})}}}};
 const deckOrder=cards=>{const m=cards.filter(x=>x.type==='法師'&&x.rank==='高級');const i=cards.filter(x=>x.type==='步兵'&&x.rank==='初級');const used=new Set([...m,...i].map(x=>x.id));return [...m,...i,...cards.filter(x=>!used.has(x.id))]};
 registerV2Playtest({of(){return nsp}},{deckOrder});
 const connect=id=>{const handlers=new Map(),s={id,messages:[],on(e,fn){handlers.set(e,fn)},join(){},send(e,data={}){let result;const fn=handlers.get(e);assert.ok(fn,'missing event '+e);fn(data,x=>result=x);assert.ok(result,'missing ack '+e);return result}};sockets.set(id,s);nsp.connect(s);return s};
 const a=connect('a'),b=connect('b'),created=a.send('v2:create',{name:'A',king:kingA}),code=created.code;
 assert.equal(created.ok,true);assert.equal(b.send('v2:join',{code,name:'B'}).ok,true);assert.equal(a.send('v2:start',{code}).ok,true);
 const view=s=>s.messages.filter(x=>x.event==='v2:state').at(-1)?.data;
 const ok=(s,e,data={})=>{const r=s.send(e,{code,...data});assert.equal(r.ok,true,e+': '+r.error);return r};
 const end=s=>{const v=ok(s,'v2:preview-end');const qinBottomIndex=v.qin&&v.drawn.length===3?2:null;const kept=v.drawn.length-(qinBottomIndex===null?0:1);const excess=Math.max(0,v.hand.length+kept-5);return ok(s,'v2:end',{qinBottomIndex,overflowDiscardIndices:Array.from({length:excess},(_,i)=>i)})};
 return {a,b,code,view,ok,end};
}
const ready=opts=>{const h=fixture(opts);h.ok(h.a,'v2:deploy',{index:0});h.end(h.a);h.ok(h.b,'v2:deploy',{index:0});h.end(h.b);return h};
for(const spell of MAGIC_DEFS){
 test('two-client selectable magic synchronizes and hides hands: '+spell.name,()=>{
  const {a,b,code,view,ok,end}=ready();
  const i=MAGIC_DEFS.findIndex(m=>m.name===spell.name);
  assert.equal(view(a).current,0);
  assert.equal(view(a).players[0].field[0].type,'法師');
  assert.equal(view(b).players[0].availableSpells,undefined);
  assert.equal(view(b).players[0].hand,undefined);
  const targets=spell.maxTargets===0?[]:[0];
  assert.equal(b.send('v2:cast',{code,magicIndex:i,mageIndex:0,targetIndices:targets,defenderPlayerIndex:0}).ok,false);
  ok(a,'v2:cast',{magicIndex:i,mageIndex:0,targetIndices:targets,defenderPlayerIndex:1});
  assert.equal(view(a).players[0].field[0].tapped,true);
  assert.deepEqual(view(a).players[0].field,view(b).players[0].field);
  assert.deepEqual(view(a).players[1].field,view(b).players[1].field);
  assert.equal(a.send('v2:cast',{code,magicIndex:i,mageIndex:0,targetIndices:targets,defenderPlayerIndex:1}).ok,false);
  end(a);
 });
}
test('poison persists through caster end and kills on defender owner end',()=>{
 const {a,b,view,ok,end}=ready();
 ok(a,'v2:cast',{magicIndex:6,mageIndex:0,targetIndices:[0],defenderPlayerIndex:1});
 assert.equal(view(b).players[1].field.length,1);
 end(a);
 assert.equal(view(b).players[1].field.length,1);
 end(b);
 assert.equal(view(a).players[1].field.length,0);
});
test('freeze prevents one defender turn of actions',()=>{
 const {a,b,code,view,ok,end}=ready();
 ok(a,'v2:cast',{magicIndex:1,mageIndex:0,targetIndices:[0],defenderPlayerIndex:1});
 end(a);
 assert.equal(view(b).players[1].field[0].tapped,true);
 assert.equal(b.send('v2:attack',{code,attackerIndex:0,defenderPlayerIndex:0}).ok,false);
 end(b);end(a);
 assert.equal(view(b).players[1].field[0].tapped,false);
});
test('Genghis exchange removes mage without obsolete magic-discard requirement',()=>{
 const {a,b,view,ok,end}=ready({kingA:'成吉思汗'});
 ok(a,'v2:ability',{fieldIndex:0,handIndex:1});
 assert.notEqual(view(a).players[0].field[0].type,'法師');
 end(a);
 assert.equal(view(b).players[0].availableSpells,undefined);
});
