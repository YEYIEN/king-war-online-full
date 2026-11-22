import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Server} from 'socket.io';
import {createRequire} from 'node:module';
const requireClient=createRequire(new URL('../client/package.json',import.meta.url));
const {io:connect}=requireClient('socket.io-client');
import {registerV2Playtest} from '../server/v2-playtest-socket.mjs';
import {MAGIC_DEFS} from '../server/rules-v2-magic.mjs';
const ordered=spell=>cards=>{
 if(cards[0]?.name)return [...cards.filter(c=>c.name===spell),...cards.filter(c=>c.name!==spell)];
 const m=cards.filter(c=>c.type==='法師'&&c.rank==='高級'),i=cards.filter(c=>c.type==='步兵'&&c.rank==='初級');
 const ids=new Set([...m,...i].map(c=>c.id));return [...m,...i,...cards.filter(c=>!ids.has(c.id))];
};
const connected=s=>new Promise((resolve,reject)=>{if(s.connected)return resolve();s.once('connect',resolve);s.once('connect_error',reject);});
const send=(s,event,data)=>new Promise((resolve,reject)=>s.timeout(3000).emit(event,data,(err,r)=>err?reject(err):resolve(r)));
const until=async(fn)=>{for(let i=0;i<200;i++){const x=fn();if(x)return x;await new Promise(r=>setTimeout(r,10));}throw Error('state synchronization timeout');};
test('real TCP: all nine spells cast and synchronize between two Socket.IO clients', {timeout:60000},async()=>{
 for(const spell of MAGIC_DEFS){
  const http=createServer(),io=new Server(http,{cors:{origin:'*'}}),clients=[];
  registerV2Playtest(io,{deckOrder:ordered(spell.name)});
  await new Promise(r=>http.listen(0,'127.0.0.1',r));
  try{
   const url='http://127.0.0.1:'+http.address().port+'/v2-playtest';
   const a=connect(url,{transports:['websocket'],reconnection:false}),b=connect(url,{transports:['websocket'],reconnection:false});
   clients.push(a,b);
   let sa,sb;a.on('v2:state',x=>sa=x);b.on('v2:state',x=>sb=x);
   await Promise.all([connected(a),connected(b)]);
   const created=await send(a,'v2:create',{name:'A'}),code=created.code;
   assert.equal(created.ok,true);assert.equal((await send(b,'v2:join',{code,name:'B'})).ok,true);
   assert.equal((await send(a,'v2:start',{code})).ok,true);
   const endTurn=async s=>{const preview=await send(s,'v2:preview-end',{code});assert.equal(preview.ok,true);const excess=Math.max(0,preview.hand.length+preview.drawn.length-5);return send(s,'v2:end',{code,overflowDiscardIndices:Array.from({length:excess},(_,i)=>i)});};
   assert.equal((await send(a,'v2:deploy',{code,index:0})).ok,true);
   assert.equal((await endTurn(a)).ok,true);
   assert.equal((await send(b,'v2:deploy',{code,index:0})).ok,true);
   assert.equal((await endTurn(b)).ok,true);
   await until(()=>sa?.players[0].availableSpells?.some(x=>x.name===spell.name)&&sa.current===0);
   const targets=spell.maxTargets===0?[]:[0];const index=MAGIC_DEFS.findIndex(x=>x.name===spell.name);
   const result=await send(a,'v2:cast',{code,magicIndex:index,mageIndex:0,targetIndices:targets,defenderPlayerIndex:1});
   assert.equal(result.ok,true,spell.name+': '+result.error);
   await until(()=>sa?.players[0].field?.[0]?.tapped&&sb?.players[0].field?.[0]?.tapped);
   assert.deepEqual(sb.players[0].field,sa.players[0].field,spell.name+' caster field');
   assert.deepEqual(sb.players[1].field,sa.players[1].field,spell.name+' enemy field');
   assert.equal(sb.players[0].availableSpells,undefined,spell.name+' privacy');
   assert.equal(sb.players[0].hand,undefined,spell.name+' hand privacy');
   assert.equal((await endTurn(a)).ok,true,spell.name+' end turn');
  }finally{for(const c of clients)c.disconnect();await new Promise(r=>io.close(r));}
 }
});
