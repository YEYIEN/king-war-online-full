import {test} from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import net from "node:net";
const requireClient=createRequire(new URL("../client/package.json",import.meta.url));
const {io}=requireClient("socket.io-client");
const cwd=fileURLToPath(new URL("../",import.meta.url));
async function freePort(){
 const server=net.createServer();
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const port=server.address().port;
 await new Promise(resolve=>server.close(resolve));return port;
}
async function connect(port){
 const socket=io(`http://127.0.0.1:${port}`,{transports:["websocket"],reconnection:false,timeout:1400});
 await new Promise((res,rej)=>{socket.once("connect",res);socket.once("connect_error",rej);});
 return socket;
}
const request=(s,event,data={})=>new Promise((res,rej)=>{
 s.timeout(4000).emit(event,data,(e,result)=>e?rej(e):res(result));
});
test("safe sockets: room isolation, private hand, rejected forged actions and flood", {timeout:25000},async t=>{
 const port=await freePort();
 const processHandle=spawn(process.execPath,["server/index.js"],{cwd,env:{...process.env,PORT:String(port),NODE_ENV:"development"},stdio:["ignore","pipe","pipe"]});
 const peers=[];let err="";
 processHandle.stderr.on("data",chunk=>{err+=chunk.toString()});
 t.after(()=>{peers.forEach(s=>s.disconnect());processHandle.kill("SIGTERM")});
 let host;
 for(let i=0;i<35;i++){
  try{host=await connect(port);break}catch{
   if(processHandle.exitCode!==null)throw new Error(err);
   await new Promise(r=>setTimeout(r,100));
  }
 }
 assert.ok(host,"server socket ready");peers.push(host);
 const health=await fetch(`http://127.0.0.1:${port}/healthz`).then(r=>r.json());
 assert.equal(health.ok,true);
 assert.equal((await request(host,"room:create",{name:"N".repeat(5000)})).ok,false);
 assert.equal((await request(host,"room:create",["unexpected"])).ok,false);
 const created=await request(host,"room:create",{name:"host",maxPlayers:2});
 assert.equal(created.ok,true);
 const guest=await connect(port);peers.push(guest);
 const outsider=await connect(port);peers.push(outsider);
 assert.equal((await request(outsider,"room:resume",{roomCode:created.room.roomCode,playerId:created.playerId,resumeToken:"forged"})).ok,false);
 const joined=await request(guest,"room:join",{name:"guest",code:created.room.roomCode});
 assert.equal(joined.ok,true);
 assert.equal((await request(guest,"room:toggleReady",{})).ok,true);
 assert.equal((await request(host,"game:start",{})).ok,true);
 const own=(await request(host,"room:resume",{roomCode:created.room.roomCode,playerId:created.playerId,resumeToken:created.resumeToken})).room;
 const guestView=(await request(guest,"room:resume",{roomCode:created.room.roomCode,playerId:joined.playerId,resumeToken:joined.resumeToken})).room;
 const opponent=own.players.find(p=>p.id!==created.playerId);
 assert.equal(opponent.hand.length,0);
 assert.ok(opponent.handCount>0);
 assert.equal(own.players.find(p=>p.id===created.playerId).hand.length,own.players.find(p=>p.id===created.playerId).handCount);
 const hidden=guestView.players.find(p=>p.id===created.playerId);
 assert.equal(hidden.hand.length,0);
 assert.ok(hidden.handCount>0);
 const toAct=own.currentPlayerId===created.playerId?guest:host;
 assert.equal((await request(toAct,"game:attackKing",{attackerId:"forged",targetPlayerId:created.playerId})).ok,false);
 let rejected=0;
 for(let i=0;i<110;i++){const reply=await request(outsider,"game:deploy",{cardId:"no-card"});if(reply.ok===false&&reply.error?.includes("頻繁"))rejected++;}
 assert.ok(rejected>0,"rapid synthetic socket flood must get explicit rejections");
});
