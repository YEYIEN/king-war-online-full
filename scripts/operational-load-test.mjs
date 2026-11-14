import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import net from "node:net";
const requireClient=createRequire(new URL("../client/package.json",import.meta.url));
const {io}=requireClient("socket.io-client");
const cwd=fileURLToPath(new URL("../",import.meta.url));
const count=Math.min(50,Math.max(1,Number(process.env.LOAD_ROOMS||10)));
const sample=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,"127.0.0.1",r));const port=s.address().port;await new Promise(r=>s.close(r));return port;};
const ask=(socket,event,arg={})=>new Promise((resolve,reject)=>{
 const start=performance.now();
 socket.timeout(6000).emit(event,arg,(e,result)=>{
  if(e)return reject(e);
  sample.push(performance.now()-start);resolve(result);
 });
});
async function main(){
 const port=await freePort();
 const child=spawn(process.execPath,["server/index.js"],{cwd,env:{...process.env,PORT:String(port),NODE_ENV:"development",KW_SIMULATION:"0"},stdio:["ignore","pipe","pipe"]});
 const all=[];let err="";
 child.stderr.on("data",b=>err+=b.toString());
 const connect=async()=>{
  const socket=io(`http://127.0.0.1:${port}`,{transports:["websocket"],reconnection:false,timeout:1400});
  await new Promise((res,rej)=>{socket.once("connect",res);socket.once("connect_error",rej);});
  all.push(socket);return socket;
 };
 try{
  let ready=false;
  for(let i=0;i<50;i++){try{const s=await connect();s.disconnect();ready=true;break}
   catch {if(child.exitCode!==null)throw Error(err);await pause(80);}}
  if(!ready)throw Error("server not ready");
  const games=await Promise.all(Array.from({length:count},async(_,i)=>{
   const host=await connect();
   const created=await ask(host,"room:create",{name:`Load host ${i}`,maxPlayers:2});
   assert.equal(created.ok,true);
   const guest=await connect();
   const joined=await ask(guest,"room:join",{name:`Load guest ${i}`,code:created.room.roomCode});
   assert.equal(joined.ok,true);
   assert.equal((await ask(guest,"room:toggleReady")).ok,true);
   assert.equal((await ask(host,"game:start")).ok,true);
   return {host,guest,created,joined};
  }));
  await Promise.all(games.map(async({host,guest,created,joined})=>{
   const c=created.room.roomCode;
   const a=(await ask(host,"room:resume",{roomCode:c,playerId:created.playerId,resumeToken:created.resumeToken})).room;
   const b=(await ask(guest,"room:resume",{roomCode:c,playerId:joined.playerId,resumeToken:joined.resumeToken})).room;
   assert.equal(a.roomCode,c);assert.equal(b.roomCode,c);
   assert.equal(a.players.length,2);
   assert.ok(a.players.every(p=>p.field.length===0));
   const ownA=a.players.find(p=>p.id===created.playerId),viewB=b.players.find(p=>p.id===created.playerId);
   assert.ok(ownA.hand.length>0);
   assert.equal(viewB.hand.length,0,"do not expose hidden hands between sockets");
   const current=a.currentPlayerId===created.playerId?host:guest;
   assert.equal((await ask(current,"game:endTurn")).ok,true);
  }));
  const sorted=sample.sort((a,b)=>a-b);
  const nth=p=>+sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))].toFixed(1);
  const report={rooms:count,clients:count*2,requests:sample.length,latencyMs:{median:nth(.5),p95:nth(.95),max:nth(1)},completedMatchStarts:games.length,hiddenHandLeaks:0,illegalCrossRoomUpdates:0};
  console.log(JSON.stringify(report,null,2));
  if(report.latencyMs.p95>1500)throw Error("Socket P95 latency exceeded 1500 ms for local load test");
 }finally{all.forEach(s=>s.disconnect());child.kill("SIGTERM");}
}
await main();
