import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import net from "node:net";
const cwd=fileURLToPath(new URL("../",import.meta.url));
const requireClient=createRequire(new URL("../client/package.json",import.meta.url));
const {io}=requireClient("socket.io-client");
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){
 const server=net.createServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));
 const port=server.address().port;await new Promise(r=>server.close(r));return port;
}
async function connect(port){
 const socket=io(`http://127.0.0.1:${port}`,{reconnection:false,transports:["websocket"],timeout:1200});
 await new Promise((r,rej)=>{socket.once("connect",r);socket.once("connect_error",rej);});
 return socket;
}
async function ask(socket,event,data={}) {
 return await new Promise((r,rej)=>socket.timeout(4000).emit(event,data,(e,v)=>e?rej(e):r(v)));
}
test("encrypted match recovers across an actual server restart", {timeout:25000},async t=>{
 const port=await freePort();
 const dir=await mkdtemp(join(tmpdir(),"kw-recovery-"));
 const secret=randomBytes(32).toString("hex");
 const env={...process.env,PORT:String(port),NODE_ENV:"development",KW_RECOVERY_DIR:dir,KW_RECOVERY_KEY:secret};
 let child=null;const peers=[];
 function start(){child=spawn(process.execPath,["server/index.js"],{cwd,env,stdio:["ignore","pipe","pipe"]});}
 async function untilConnect(){
  for(let i=0;i<40;i++){
   try{const s=await connect(port);peers.push(s);return s;}catch(e){
    if(child.exitCode!==null)throw new Error("Server failed to start");
    await pause(100);
   }
  }
  throw new Error("Server connection timeout");
 }
 t.after(async()=>{peers.forEach(s=>s.disconnect());child?.kill("SIGTERM");await rm(dir,{recursive:true,force:true})});
 start();const socket=await untilConnect();
 const started=await ask(socket,"singleplayer:start",{name:"Snapshot test",difficulty:"normal"});
 assert.equal(started.ok,true);
 const roomCode=started.room.roomCode;
 let saved=false;
 for(let i=0;i<60;i++){
  const files=await readdir(dir);
  if(files.includes(`${roomCode}.kwroom`)){saved=true;break}
  await pause(50);
 }
 assert.ok(saved,"server wrote encrypted match snapshot");
 socket.disconnect();
 const first=child;
 first.kill("SIGTERM");
 await new Promise(r=>first.once("exit",r));
 start();
 const rejoined=await untilConnect();
 const result=await ask(rejoined,"room:resume",{
  roomCode,playerId:started.playerId,resumeToken:started.resumeToken
 });
 assert.equal(result.ok,true);
 assert.equal(result.room.roomCode,roomCode);
 assert.equal(result.room.status,"playing");
 const own=result.room.players.find(p=>p.id===started.playerId);
 const rival=result.room.players.find(p=>p.id!==started.playerId);
 assert.ok(own.hand.length>0,"original hand recoverable only to authenticated owner");
 assert.equal(rival.hand.length,0,"opponent's hidden hand is not sent after restore");
 assert.ok(rival.handCount>=0);
 assert.equal((await ask(rejoined,"room:resume",{roomCode,playerId:started.playerId,resumeToken:"invalid"})).ok,false);
});

test("two human players recover regardless of rejoin order without seeing each other's hand",{timeout:25000},async t=>{
 const port=await freePort(),dir=await mkdtemp(join(tmpdir(),"kw-recovery-multi-"));
 const env={...process.env,PORT:String(port),NODE_ENV:"development",KW_RECOVERY_DIR:dir,
  KW_RECOVERY_KEY:randomBytes(32).toString("hex")};
 let child;const sockets=[];
 function start(){child=spawn(process.execPath,["server/index.js"],{cwd,env,stdio:["ignore","pipe","pipe"]});}
 async function joinServer(){
  for(let i=0;i<40;i++){
   try{const socket=await connect(port);sockets.push(socket);return socket;}
   catch{if(child.exitCode!==null)throw Error("Server not running");await pause(100);}
  }
  throw Error("Server timeout");
 }
 t.after(async()=>{sockets.forEach(s=>s.disconnect());child?.kill("SIGTERM");await rm(dir,{recursive:true,force:true})});
 start();
 const a=await joinServer(),b=await joinServer();
 const hosted=await ask(a,"room:create",{name:"First",maxPlayers:2});
 assert.equal(hosted.ok,true);
 const guest=await ask(b,"room:join",{name:"Second",code:hosted.room.roomCode});
 assert.equal(guest.ok,true);
 assert.equal((await ask(b,"room:toggleReady")).ok,true);
 assert.equal((await ask(a,"game:start")).ok,true);
 const roomCode=hosted.room.roomCode;
 const state=(await ask(a,"room:resume",{roomCode,playerId:hosted.playerId,resumeToken:hosted.resumeToken})).room;
 for(let i=0;i<60;i++){
  if((await readdir(dir)).includes(`${roomCode}.kwroom`))break;
  await pause(50);
 }
 assert.ok((await readdir(dir)).includes(`${roomCode}.kwroom`));
 const previous=child;
 previous.kill("SIGTERM");
 await new Promise(r=>previous.once("exit",r));
 start();
 const users=[
  {id:hosted.playerId,token:hosted.resumeToken},
  {id:guest.playerId,token:guest.resumeToken}
 ];
 const active=users.find(u=>u.id===state.currentPlayerId);
 const inactive=users.find(u=>u.id!==state.currentPlayerId);
 const inactiveSocket=await joinServer();
 const inactiveResume=await ask(inactiveSocket,"room:resume",{roomCode,playerId:inactive.id,resumeToken:inactive.token});
 assert.equal(inactiveResume.ok,true);
 assert.equal(inactiveResume.room.status,"playing");
 assert.ok(inactiveResume.room.players.find(p=>p.id===active.id).handCount>0);
 assert.equal(inactiveResume.room.players.find(p=>p.id===active.id).hand.length,0);
 const activeSocket=await joinServer();
 const activeResume=await ask(activeSocket,"room:resume",{roomCode,playerId:active.id,resumeToken:active.token});
 assert.equal(activeResume.ok,true);
 assert.ok(activeResume.room.players.find(p=>p.id===active.id).hand.length>0);
 assert.equal(activeResume.room.players.find(p=>p.id===inactive.id).hand.length,0);
 assert.equal((await ask(activeSocket,"game:endTurn")).ok,true);
});
