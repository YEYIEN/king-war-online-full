import {test} from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import net from "node:net";
const requireClient=createRequire(new URL("../client/package.json",import.meta.url));
const {io}=requireClient("socket.io-client");
test("server refuses new rooms when full but permits joining existing lobby",{timeout:15000},async t=>{
 const s=net.createServer();
 await new Promise((ok,fail)=>s.once("error",fail).listen(0,"127.0.0.1",ok));
 const port=s.address().port;await new Promise(ok=>s.close(ok));
 const child=spawn(process.execPath,["server/index.js"],{
  cwd:fileURLToPath(new URL("../",import.meta.url)),
  env:{...process.env,PORT:String(port),NODE_ENV:"development",KW_MAX_ROOMS:"1"},
  stdio:["ignore","pipe","pipe"]});
 let stderr="";child.stderr.on("data",x=>stderr+=x.toString());
 const clients=[];
 t.after(()=>{clients.forEach(x=>x.disconnect());child.kill("SIGTERM")});
 async function connect(){
  for(let i=0;i<40;i++){
   const c=io(`http://127.0.0.1:${port}`,{transports:["websocket"],reconnection:false,timeout:1000});
   try{await new Promise((ok,fail)=>{c.once("connect",ok);c.once("connect_error",fail)});clients.push(c);return c;}
   catch(e){c.disconnect();if(child.exitCode!==null)throw new Error(stderr);if(i===39)throw e;
    await new Promise(r=>setTimeout(r,80));}
  }
 }
 const req=(c,event,data={})=>new Promise((ok,fail)=>c.timeout(3000).emit(event,data,(err,res)=>err?fail(err):ok(res)));
 const a=await connect(),b=await connect();
 const one=await req(a,"room:create",{name:"host",maxPlayers:2});
 assert.equal(one.ok,true);
 const fail=await req(b,"room:create",{name:"another",maxPlayers:2});
 assert.equal(fail.ok,false);
 const join=await req(b,"room:join",{name:"guest",code:one.room.roomCode});
 assert.equal(join.ok,true,"existing room entry is still allowed under global cap");
});
