import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import net from "node:net";
const clientRequire=createRequire(new URL("../client/package.json",import.meta.url));
const {io}=clientRequire("socket.io-client");
async function port(){
 const server=net.createServer();
 await new Promise((resolve,reject)=>server.once("error",reject).listen(0,"127.0.0.1",resolve));
 const value=server.address().port;
 await new Promise(resolve=>server.close(resolve));
 return value;
}
async function request(socket,event,payload={}){
 return new Promise((resolve,reject)=>socket.timeout(2500).emit(event,payload,(err,r)=>err?reject(err):resolve(r)));
}
test("malformed packets and high volume fail closed without affecting legitimate game clients", {timeout:20000},async t=>{
 const p=await port(),child=spawn(process.execPath,["server/index.js"],{
  cwd:fileURLToPath(new URL("../",import.meta.url)),
  env:{...process.env,PORT:String(p),NODE_ENV:"development"},stdio:["ignore","pipe","pipe"]});
 let stderr="";child.stderr.on("data",c=>stderr+=c.toString());
 const sockets=[];
 t.after(()=>{for(const x of sockets)x.disconnect();child.kill("SIGTERM");});
 async function connect(){
  for(let i=0;i<50;i++){
   const s=io(`http://127.0.0.1:${p}`,{transports:["websocket"],reconnection:false,timeout:1000});
   try{
    await new Promise((resolve,reject)=>{s.once("connect",resolve);s.once("connect_error",reject);});
    sockets.push(s);return s;
   }catch(error){s.disconnect();if(child.exitCode!==null)throw new Error(stderr);
    if(i===49)throw error;await new Promise(r=>setTimeout(r,100));}
  }
 }
 const first=await connect(),other=await connect();
 assert.equal((await request(first,"room:create",{name:"tester",maxPlayers:2})).ok,true);
 const large=await request(first,"room:join",{name:"x".repeat(15000),code:"ABCDE"});
 assert.equal(large.ok,false,"oversized payload rejected");
 const invalid=await request(first,"game:deploy",null);
 assert.equal(invalid.ok,false,"null rejected without throwing");
 const missing=await new Promise((resolve,reject)=>first.timeout(2500).emit("room:join",(err,response)=>err?reject(err):resolve(response)));
 assert.equal(missing.ok,false,"missing required payload rejected without crashing server");
 for(let i=0;i<23;i++){
  const result=await request(first,"room:create",{name:"p"});
  assert.equal(result.ok,true,"within allotted creation budget");
 }
 assert.equal((await request(first,"room:create",{name:"overflow"})).ok,false,"abusive room creation rejected");
 assert.equal((await request(other,"room:create",{name:"normal"})).ok,true,"different socket can play normally");
 assert.equal(child.exitCode,null);
});
