import {test} from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {encryptRoom,decryptRoom} from "../server/match-recovery.js";

function room(){
 return {code:"KWABC234",status:"playing",currentPlayerId:"human",hostId:"human",
  players:[
   {id:"human",socketId:"SOCKET_PRIVATE",connected:true,resumeToken:"TOKEN_PRIVATE",hp:17,
    hand:[{id:"SECRET_CARD",type:"步兵"}],magic:[],field:[],king:{name:"秦始皇"}},
   {id:"bot",socketId:"AI_bot",isAI:true,connected:true,hp:28,hand:[],magic:[],field:[],
    king:{name:"成吉思汗"}}
  ],log:["Normal move"],settings:{turnTimeLimit:0},unitDeck:[],magicDeck:[]};
}
test("encrypted recovery preserves board and secret hand without storing socket binding",()=>{
 const secret=randomBytes(32),original=room();
 const encrypted=encryptRoom(original,secret);
 assert.ok(!encrypted.toString().includes("SECRET_CARD"));
 assert.ok(!encrypted.toString().includes("TOKEN_PRIVATE"));
 const restored=decryptRoom(encrypted,secret,original.code);
 assert.equal(restored.players[0].hand[0].id,"SECRET_CARD");
 assert.equal(restored.players[0].resumeToken,"TOKEN_PRIVATE");
 assert.equal(restored.players[0].socketId,null);
 assert.equal(restored.players[0].connected,false);
 assert.equal(restored.players[1].socketId,null);
 assert.equal(restored.status,"playing");
});
test("modified ciphertext, wrong key or unexpected room code are rejected",()=>{
 const secret=randomBytes(32),record=encryptRoom(room(),secret);
 const tampered=Buffer.from(record);tampered[tampered.length-1]^=1;
 assert.throws(()=>decryptRoom(tampered,secret,"KWABC234"));
 assert.throws(()=>decryptRoom(record,randomBytes(32),"KWABC234"));
 assert.throws(()=>decryptRoom(record,secret,"KWAAAAAA"));
});
test("snapshots only accept correctly formed, active matches",()=>{
 const secret=randomBytes(32),r=room();r.status="ended";
 assert.throws(()=>decryptRoom(encryptRoom(r,secret),secret,r.code));
});
