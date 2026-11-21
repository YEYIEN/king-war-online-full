import test from 'node:test';
import assert from 'node:assert/strict';
import {registerV2Playtest} from './v2-playtest-socket.mjs';
import {MAGIC_DEFS} from './rules-v2-magic.mjs';
class Socket {
 constructor(id){this.id=id;this.handlers=new Map();this.messages=[];}
 on(event,handler){this.handlers.set(event,handler);}
 join(){}
 emit(event,payload){this.messages.push({event,payload});}
 send(event,data={}){let ack;this.handlers.get(event)(data,r=>ack=r);assert.ok(ack,'missing ack '+event);return ack;}
}
function fixture(spell){
 const sockets=new Map();
 const namespace={on(event,fn){if(event==='connection')this.connect=fn;},to(id){return {emit(event,payload){sockets.get(id)?.emit(event,payload);}}}};
 const deckOrder=cards=>{
  if(cards[0]?.name)return [...cards.filter(c=>c.name===spell),...cards.filter(c=>c.name!==spell)];
  const m=cards.filter(c=>c.type==='法師'&&c.rank==='高級');
  const infantry=cards.filter(c=>c.type==='步兵'&&c.rank==='初級');
  const ids=new Set([...m,...infantry].map(x=>x.id));
  return [...m,...infantry,...cards.filter(c=>!ids.has(c.id))];
 };
 registerV2Playtest({of(){return namespace;}},{deckOrder});
 const connect=id=>{const s=new Socket(id);sockets.set(id,s);namespace.connect(s);return s;};
 const a=connect('a'),b=connect('b'),code=a.send('v2:create',{name:'A'}).code;
 assert.equal(b.send('v2:join',{code,name:'B'}).ok,true);
 assert.equal(a.send('v2:start',{code}).ok,true);
 const view=s=>s.messages.filter(m=>m.event==='v2:state').at(-1)?.payload;
 return {a,b,code,view};
}
for(const def of MAGIC_DEFS){
 test('two-client magic lifecycle: '+def.name,()=>{
  const {a,b,code,view}=fixture(def.name);
  assert.equal(a.send('v2:deploy',{code,index:0}).ok,true);
  assert.equal(a.send('v2:end',{code}).ok,true);
  assert.equal(b.send('v2:deploy',{code,index:0}).ok,true);
  assert.equal(b.send('v2:end',{code}).ok,true);
  const before=view(a),other=view(b);
  assert.equal(before.current,0);
  assert.equal(before.players[0].field[0].type,'法師');
  assert.equal(before.players[0].magic[0].name,def.name);
  assert.equal(other.players[0].magic,undefined,'enemy cannot read caster magic');
  const targetIndices=def.maxTargets===0?[]:[0];
  assert.equal(b.send('v2:cast',{code,magicIndex:0,mageIndex:0,targetIndices}).ok,false,'opponent cannot cast during A turn');
  const response=a.send('v2:cast',{code,magicIndex:0,mageIndex:0,targetIndices});
  assert.equal(response.ok,true,def.name+': '+response.error);
  const after=view(a),remote=view(b);
  assert.equal(after.players[0].magic.length,0);
  assert.equal(after.players[0].field[0].tapped,true);
  assert.deepEqual(remote.players[0].field,after.players[0].field,'field synchronized');
  assert.deepEqual(remote.players[1].field,after.players[1].field,'enemy field synchronized');
  assert.equal(remote.players[0].magic,undefined);
  assert.equal(after.players[1].magic,undefined);
  assert.equal(a.send('v2:cast',{code,magicIndex:0,mageIndex:0,targetIndices}).ok,false,'no second cast without card');
  assert.equal(a.send('v2:end',{code}).ok,true,'turn resolution succeeds');
 });
}

test('poison kills victim at the end of victim owner turn and syncs both players',()=>{
 const {a,b,code,view}=fixture('毒藥瓶');
 assert.equal(a.send('v2:deploy',{code,index:0}).ok,true);
 assert.equal(a.send('v2:end',{code}).ok,true);
 assert.equal(b.send('v2:deploy',{code,index:0}).ok,true);
 assert.equal(b.send('v2:end',{code}).ok,true);
 assert.equal(a.send('v2:cast',{code,magicIndex:0,mageIndex:0,targetIndices:[0]}).ok,true);
 assert.equal(view(b).players[1].field.length,1);
 assert.equal(a.send('v2:end',{code}).ok,true);
 assert.equal(view(b).players[1].field.length,1,'poison does not kill before victim turn end');
 assert.equal(b.send('v2:end',{code}).ok,true);
 assert.equal(view(a).players[1].field.length,0);
 assert.equal(view(b).players[1].field.length,0);
});
test('freeze blocks low-rank unit for one owner turn',()=>{
 const {a,b,code,view}=fixture('冰凍術');
 assert.equal(a.send('v2:deploy',{code,index:0}).ok,true);
 assert.equal(a.send('v2:end',{code}).ok,true);
 assert.equal(b.send('v2:deploy',{code,index:0}).ok,true);
 assert.equal(b.send('v2:end',{code}).ok,true);
 assert.equal(a.send('v2:cast',{code,magicIndex:0,mageIndex:0,targetIndices:[0]}).ok,true);
 assert.equal(a.send('v2:end',{code}).ok,true);
 assert.equal(view(b).players[1].field[0].tapped,true,'frozen infantry cannot act');
 assert.equal(b.send('v2:attack',{code,attackerIndex:0}).ok,false);
 assert.equal(b.send('v2:end',{code}).ok,true);
 assert.equal(a.send('v2:end',{code}).ok,true);
 assert.equal(view(b).players[1].field[0].tapped,false);
});

test('losing last mage requires explicit magic discard before ending turn',()=>{
 const unitOrder=cards=>{
  const mage=cards.find(c=>c.type==='法師'&&c.rank==='高級');
  const infantry=cards.filter(c=>c.type==='步兵'&&c.rank==='初級');
  const used=new Set([mage,...infantry.slice(0,5)].map(c=>c.id));
  return [mage,...infantry,...cards.filter(c=>!used.has(c.id))];
 };
 const {a,b,code,view}=fixture('火球術',{kingA:'成吉思汗',unitOrder});
 assert.equal(a.send('v2:deploy',{code,index:0}).ok,true);
 assert.equal(a.send('v2:end',{code}).ok,true);
 assert.equal(b.send('v2:deploy',{code,index:0}).ok,true);
 assert.equal(b.send('v2:end',{code}).ok,true);
 assert.equal(view(a).players[0].magic.length,1);
 assert.equal(a.send('v2:ability',{code,fieldIndex:0,handIndex:0}).ok,true);
 assert.equal(view(a).players[0].field[0].type,'步兵');
 assert.equal(a.send('v2:end',{code}).ok,false);
 assert.equal(a.send('v2:discard-magic',{code,indices:[0]}).ok,true);
 assert.equal(view(a).players[0].magic.length,0);
 assert.equal(a.send('v2:end',{code}).ok,true);
 assert.equal(view(b).players[0].magic,undefined);
});
