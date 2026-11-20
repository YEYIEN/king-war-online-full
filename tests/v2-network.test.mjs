import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Server} from 'socket.io';
import {io as connect} from '../client/node_modules/socket.io-client/build/esm/index.js';
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
  const deployed=await send(a,'v2:deploy',{code:created.code,index:0});assert.equal(deployed.ok,true);
  const illegal=await send(a,'v2:attack',{code:created.code,attackerIndex:0});assert.equal(illegal.ok,false);
  const ended=await send(a,'v2:end',{code:created.code});assert.equal(ended.ok,true);
  const wrongTurn=await send(a,'v2:end',{code:created.code});assert.equal(wrongTurn.ok,false);
  const otherDeployed=await send(b,'v2:deploy',{code:created.code,index:0});assert.equal(otherDeployed.ok,true);
  const otherEnded=await send(b,'v2:end',{code:created.code});assert.equal(otherEnded.ok,true);
 }finally{await close()}
});
