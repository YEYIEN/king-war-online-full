import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import net from "node:net";
import {replenishDeckIfEmpty} from "../server/deck-cycle.js";
const {io}=createRequire(new URL("../client/package.json",import.meta.url))("socket.io-client");
async function freePort(){
 const server=net.createServer();
 await new Promise((res,rej)=>server.once("error",rej).listen(0,"127.0.0.1",res));
 const port=server.address().port;
 await new Promise(res=>server.close(res));
 return port;
}
async function request(socket,name,args={}){
 return new Promise((res,rej)=>socket.timeout(5000).emit(name,args,(err,data)=>err?rej(err):res(data)));
}
test("a depleted unit draw pile renews without consuming cards owned by players",{timeout:10000},()=>{
 const held={id:"owned",type:"步兵"};
 const room={unitDeck:[],log:[],players:[{hand:[held],field:[]}]};
 let nextId=0;
 const create=()=>[{id:"fresh-"+(++nextId)},{id:"fresh-"+(++nextId)}];
 assert.equal(replenishDeckIfEmpty(room,"unitDeck",create,"兵種"),true);
 const first=room.unitDeck.shift();
 room.unitDeck.shift();
 assert.equal(replenishDeckIfEmpty(room,"unitDeck",create,"兵種"),true);
 assert.equal(room.unitDeck.length,2);
 assert.notEqual(first.id,room.unitDeck[0].id);
 assert.equal(room.players[0].hand[0],held);
 assert.equal(room.deckCycles.unitDeck,2);
 assert.equal(room.log.length,2);
 assert.equal(replenishDeckIfEmpty(room,"unitDeck",create,"兵種"),false);
 assert.throws(()=>replenishDeckIfEmpty(room,"wrong",create,"牌"),/Invalid deck/);
});
test("magic stock can restart independently after it is exhausted",()=>{
 const room={unitDeck:[{id:"unit"}],magicDeck:[],log:[]};
 assert.equal(replenishDeckIfEmpty(room,"magicDeck",()=>[{id:"spell-2"}],"魔法"),true);
 assert.equal(room.unitDeck[0].id,"unit");
 assert.equal(room.magicDeck[0].id,"spell-2");
 assert.equal(room.deckCycles.magicDeck,1);
});
test("tutorial guides a player through eleven REAL actions including last stand, and no quiz",{timeout:30000},async t=>{
 const port=await freePort();
 const child=spawn(process.execPath,["server/index.js"],{
  cwd:fileURLToPath(new URL("../",import.meta.url)),
  env:{...process.env,NODE_ENV:"development",PORT:String(port),KW_SIMULATION:"0"},
  stdio:"ignore"
 });
 let socket;
 t.after(()=>{socket?.disconnect();child.kill("SIGTERM");});
 for(let attempt=0;attempt<45;attempt++){
  socket=io(`http://127.0.0.1:${port}`,{transports:["websocket"],reconnection:false,timeout:700});
  try{await new Promise((res,rej)=>{socket.once("connect",res);socket.once("connect_error",rej)});break;}
  catch(e){socket.disconnect();socket=null;if(attempt===44||child.exitCode!==null)throw e;await new Promise(res=>setTimeout(res,90));}
 }
 const started=await request(socket,"tutorial:start",{name:"Student"});
 assert.equal(started.ok,true);
 const {roomCode}=started.room;
 const view=async()=>{
  const r=await request(socket,"room:resume",{roomCode,playerId:started.playerId,resumeToken:started.resumeToken});
  assert.equal(r.ok,true,JSON.stringify(r));
  return r.room;
 };
 let room=await view();
 const self=()=>room.players.find(p=>p.id===started.playerId);
 const enemy=()=>room.players.find(p=>p.id!==started.playerId);
 const card=name=>self().hand.find(c=>c.name===name);
 const own=name=>self().field.find(c=>c.name===name);
 const other=name=>enemy().field.find(c=>c.name===name);
 async function step(name,payload,next){
  const r=await request(socket,name,payload);
  assert.equal(r.ok,true,`${name}: ${JSON.stringify(r)}`);
  room=await view();
  assert.equal(room.tutorialProgress,next);
 }
 assert.equal(room.tutorialProgress,0);
 const wrong=await request(socket,"game:deploy",{cardId:card("中級步兵").id});
 assert.equal(wrong.ok,false);
 await step("game:deploy",{cardId:card("中級騎兵").id},1);
 assert.equal((await request(socket,"game:attackKing",{attackerId:own("初級騎兵").id,targetPlayerId:enemy().id})).ok,false);
 await step("game:castMagic",{magicId:self().magic[0].id,casterId:own("初級法師").id,targetPlayerId:self().id,targetUnitIds:[own("中級騎兵").id]},2);
 await step("game:attackUnit",{attackerId:own("中級騎兵").id,targetPlayerId:enemy().id,defenderId:other("中級弓兵").id},3);
 assert.equal(enemy().field.length,0);
 await step("game:attackKing",{attackerId:own("初級騎兵").id,targetPlayerId:enemy().id},4);
 await step("game:endTurn",{},5);
 assert.equal(other("初級步兵").type,"步兵");
 assert.ok(card("中級步兵"));
 await step("game:deploy",{cardId:card("中級步兵").id},6);
 assert.equal((await request(socket,"game:attackKing",{attackerId:own("初級騎兵").id,targetPlayerId:enemy().id})).ok,false);
 await step("game:attackUnit",{attackerId:own("中級騎兵").id,targetPlayerId:enemy().id,defenderId:other("初級步兵").id},7);
 assert.equal(enemy().field.length,0);
 await step("game:attackKing",{attackerId:own("初級騎兵").id,targetPlayerId:enemy().id},8);
 await step("game:endTurn",{},9);
 assert.equal(room.status,"playing");
 assert.equal(room.tutorialProgress,9);
 const lastStand=await request(socket,"game:lastStand",{mode:"defense"});
 assert.equal(lastStand.ok,true,JSON.stringify(lastStand));
 room=await view();
 assert.equal(room.tutorialProgress,10);
 await step("game:endTurn",{},11);
 assert.equal(room.status,"tutorialComplete");
 assert.equal(enemy().hp,22, "final tutorial scenario deliberately sets enemy HP to 22");
});
