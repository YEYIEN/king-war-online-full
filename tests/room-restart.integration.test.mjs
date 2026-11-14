import {test} from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {randomBytes} from "node:crypto";
import {mkdtemp,rm,readdir,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import net from "node:net";
import {decryptRoom} from "../server/room-snapshots.js";
const requireClient=createRequire(new URL("../client/package.json",import.meta.url));
const {io}=requireClient("socket.io-client");
async function freePort(){
 const s=net.createServer();await new Promise((ok,fail)=>s.once("error",fail).listen(0,"127.0.0.1",ok));
 const p=s.address().port;await new Promise(ok=>s.close(ok));return p;
}
async function connect(port){
 let lastError;
 for(let n=0;n<40;n++){
  const s=io(`http://127.0.0.1:${port}`,{transports:["websocket"],reconnection:false,timeout:700});
  try{
   await new Promise((ok,fail)=>{s.once("connect",ok);s.once("connect_error",fail)});
   return s;
  }catch(error){lastError=error;s.disconnect();await new Promise(r=>setTimeout(r,100));}
 }
 throw lastError;
}
function req(s,event,data={}){return new Promise((ok,fail)=>s.timeout(2500).emit(event,data,(err,value)=>err?fail(err):ok(value)))}
async function end(child){
 if(child.exitCode!==null)return;
 child.kill("SIGTERM");
 await Promise.race([new Promise(r=>child.once("exit",r)),new Promise(r=>setTimeout(r,3000))]);
 if(child.exitCode===null)child.kill("SIGKILL");
}
test("opt-in encrypted active match restores players, hands and turn after server restart",{timeout:27000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),"kw-resume-integration-"));
 const secret=randomBytes(32).toString("hex"),p=await freePort();
 const children=[],clients=[];
 t.after(async()=>{
  for(const c of clients)c.disconnect();
  for(const c of children)await end(c);
  await rm(dir,{recursive:true,force:true});
 });
 function launch(){
  const child=spawn(process.execPath,["server/index.js"],{
   cwd:fileURLToPath(new URL("../",import.meta.url)),
   env:{...process.env,NODE_ENV:"development",PORT:String(p),
    KW_STATE_DIR:dir,KW_STATE_KEY:secret},
   stdio:["ignore","pipe","pipe"]});
  children.push(child);
  return child;
 }
 const firstServer=launch();
 const host=await connect(p),guest=await connect(p);
 clients.push(host,guest);
 const hostStarted=await req(host,"room:create",{name:"Original host",maxPlayers:2});
 assert.equal(hostStarted.ok,true);
 const roomCode=hostStarted.room.roomCode;
 const joined=await req(guest,"room:join",{name:"Original guest",code:roomCode});
 assert.equal(joined.ok,true);
 assert.equal((await req(guest,"room:toggleReady",{})).ok,true);
 assert.equal((await req(host,"game:start",{})).ok,true);
 const before=(await req(host,"room:resume",{roomCode,playerId:hostStarted.playerId,resumeToken:hostStarted.resumeToken})).room;
 assert.equal(before.status,"playing");
 let encrypted;
 for(let n=0;n<50;n++){
  const names=(await readdir(dir)).filter(x=>x.endsWith(".kwstate"));
  if(names.length){
   const ciphertext=await readFile(join(dir,names[0]),"utf8");
   try{
    const record=decryptRoom(ciphertext,Buffer.from(secret,"hex"));
    if(record.status==="playing"){encrypted=record;break;}
   }catch{}
  }
  await new Promise(r=>setTimeout(r,60));
 }
 assert.ok(encrypted,"current active match persisted");
 assert.equal(encrypted.currentPlayerId,before.currentPlayerId);
 await end(firstServer);
 const nextServer=launch();
 const restoredHost=await connect(p),restoredGuest=await connect(p);
 clients.push(restoredHost,restoredGuest);
 const a=await req(restoredHost,"room:resume",{roomCode,playerId:hostStarted.playerId,resumeToken:hostStarted.resumeToken});
 const b=await req(restoredGuest,"room:resume",{roomCode,playerId:joined.playerId,resumeToken:joined.resumeToken});
 assert.equal(a.ok,true,JSON.stringify(a));
 assert.equal(b.ok,true,JSON.stringify(b));
 assert.equal(a.room.currentPlayerId,before.currentPlayerId);
 assert.equal(a.room.status,"playing");
 const pBefore=before.players.find(x=>x.id===hostStarted.playerId);
 const pAfter=a.room.players.find(x=>x.id===hostStarted.playerId);
 assert.deepEqual(pAfter.hand,pBefore.hand);
 assert.equal(pAfter.king.name,pBefore.king.name);
 assert.equal(nextServer.exitCode,null);
});
