import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Server} from 'socket.io';
import {createRequire} from 'node:module';
const clientRequire=createRequire(new URL('../client/package.json',import.meta.url));
const {io:connect}=clientRequire('socket.io-client');
import {registerV2Playtest} from '../server/v2-playtest-socket.mjs';
test('real TCP Socket.IO clients join and complete a two-player turn', {timeout:20000}, async()=>{
 const http=createServer();const server=new Server(http,{cors:{origin:'*'}});registerV2Playtest(server);
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+http.address().port+'/v2-playtest';
 const a=connect(url,{transports:['websocket'],reconnection:false}),b=connect(url,{transports:['websocket'],reconnection:false});
 const close=async()=>{a.disconnect();b.disconnect();await new Promise(resolve=>server.close(resolve))};
 const connected=s=>new Promise((resolve,reject)=>{if(s.connected)return resolve();s.once('connect',resolve);s.once('connect_error',reject)});
 const send=(s,event,payload)=>new Promise((resolve,reject)=>s.timeout(3000).emit(event,payload,(err,result)=>err?reject(err):resolve(result)));
 try{
  await Promise.all([connected(a),connected(b)]);
  const created=await send(a,'v2:create',{name:'甲'});assert.equal(created.ok,true);
  const joined=await send(b,'v2:join',{code:created.code,name:'乙'});assert.equal(joined.ok,true);
  const started=await send(a,'v2:start',{code:created.code});assert.equal(started.ok,true);
  const endTurn=async s=>{const preview=await send(s,'v2:preview-end',{code:created.code});assert.equal(preview.ok,true);const excess=Math.max(0,preview.hand.length+preview.drawn.length-5);return send(s,'v2:end',{code:created.code,overflowDiscardIndices:Array.from({length:excess},(_,i)=>i)});};
  const deployed=await send(a,'v2:deploy',{code:created.code,index:0});assert.equal(deployed.ok,true);
  const illegal=await send(a,'v2:attack',{code:created.code,attackerIndex:0});assert.equal(illegal.ok,false);
  const ended=await endTurn(a);assert.equal(ended.ok,true);
  const wrongTurn=await send(a,'v2:end',{code:created.code});assert.equal(wrongTurn.ok,false);
  const otherDeployed=await send(b,'v2:deploy',{code:created.code,index:0});assert.equal(otherDeployed.ok,true);
  const otherEnded=await endTurn(b);assert.equal(otherEnded.ok,true);
 }finally{await close()}
});

test('real TCP: two players complete a deterministic game and receive the same winner', {timeout:20000}, async()=>{
 const http=createServer(),server=new Server(http,{cors:{origin:'*'}});
 const deckOrder=cards=>{
  const high=cards.filter(c=>c.type==='弓兵'&&c.rank==='高級');
  const used=new Set(high.map(c=>c.id));
  return [...high,...cards.filter(c=>!used.has(c.id))];
 };
 registerV2Playtest(server,{deckOrder});
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+http.address().port+'/v2-playtest';
 const a=connect(url,{transports:['websocket'],reconnection:false});
 const b=connect(url,{transports:['websocket'],reconnection:false});
 let sa,sb;
 a.on('v2:state',v=>sa=v);b.on('v2:state',v=>sb=v);
 const send=(s,e,data)=>new Promise((resolve,reject)=>s.timeout(3000).emit(e,data,(err,result)=>err?reject(err):resolve(result)));
 const wait=async predicate=>{for(let n=0;n<200;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10))}throw Error('state synchronization timeout')};
 const close=async()=>{a.disconnect();b.disconnect();await new Promise(resolve=>server.close(resolve))};
 try{
  await Promise.all([new Promise((resolve,reject)=>{if(a.connected)resolve();else{a.once('connect',resolve);a.once('connect_error',reject)}}),new Promise((resolve,reject)=>{if(b.connected)resolve();else{b.once('connect',resolve);b.once('connect_error',reject)}})]);
  const created=await send(a,'v2:create',{name:'A',king:'亞歷山大大帝'}),code=created.code;
  assert.equal(created.ok,true);
  assert.equal((await send(b,'v2:join',{code,name:'B',king:'屋大維奧古斯都'})).ok,true);
  assert.equal((await send(a,'v2:start',{code})).ok,true);
  await wait(()=>sa?.status==='playing'&&sb?.status==='playing');
  assert.equal(sa.players[0].hand.length,5);
  assert.equal(sb.players[0].hand,undefined,'opponent cannot read the attacker hand');
  assert.equal(sa.players[1].hand,undefined,'attacker cannot read the defender hand');
  assert.equal((await send(a,'v2:deploy',{code,index:0})).ok,true);
  const end=async s=>{
   const p=await send(s,'v2:preview-end',{code});assert.equal(p.ok,true,p.error);
   const excess=Math.max(0,p.hand.length+p.drawn.length-5);
   const r=await send(s,'v2:end',{code,overflowDiscardIndices:Array.from({length:excess},(_,i)=>i)});
   assert.equal(r.ok,true,r.error);
  };
  await end(a);await end(b);
  let attacks=0;
  for(let round=0;round<6;round++){
   const declaration=await send(a,'v2:attack',{code,attackerIndex:0,defenderPlayerIndex:1});
   assert.equal(declaration.ok,true,declaration.error);
   const hit=await send(b,'v2:respond-attack',{code,handIndex:null});
   assert.equal(hit.ok,true,hit.error);
   attacks++;
   await wait(()=>sa?.players[1].hp===Math.max(0,24-attacks*5));
   if(sa.status==='finished')break;
   await end(a);await end(b);
  }
  await wait(()=>sa?.status==='finished'&&sb?.status==='finished');
  assert.equal(attacks,5);
  assert.equal(sa.winner,'A');
  assert.equal(sb.winner,'A');
  assert.equal(sa.players[1].hp,0);
  assert.equal(sb.players[0].hand,undefined);
  assert.equal(sa.players[1].hand,undefined);
 }finally{await close()}
});
