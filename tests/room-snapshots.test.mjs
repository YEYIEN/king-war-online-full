import {test} from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtemp,readFile,rm,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {encryptRoom,decryptRoom,saveRoomSnapshot,loadRoomSnapshots,removeRoomSnapshot} from "../server/room-snapshots.js";

const key=()=>randomBytes(32).toString("hex");
const example=()=>({code:"KWSECRET",status:"playing",hostId:"HIDDEN_ID",currentPlayerId:"HIDDEN_ID",
 players:[{id:"HIDDEN_ID",name:"PRIVATE NAME",connected:true,socketId:"PRIVATE_SOCKET",resumeToken:"SECRET_TOKEN",
  isAI:false,king:{name:"亞歷山大大帝"},hand:[{id:"CARD_SECRET",name:"騎兵"}],field:[],magic:[],hp:30}],
 simProgress:{trailingPlayers:new Set(["HIDDEN_ID"]),criticalPlayers:new Set([])},
 unitDeck:[],magicDeck:[],settings:{turnTimeLimit:60},matchMetrics:{events:{deploy:1}}});
test("AES-GCM snapshot roundtrip protects all private game state and rejects tampering",()=>{
 const original=example(),rawKey=Buffer.from(key(),"hex");
 const cipher=encryptRoom(original,rawKey);
 assert.ok(!cipher.includes("PRIVATE NAME"));
 assert.ok(!cipher.includes("SECRET_TOKEN"));
 assert.ok(!cipher.includes("CARD_SECRET"));
 const restored=decryptRoom(cipher,rawKey);
 assert.equal(restored.players[0].resumeToken,original.players[0].resumeToken);
 assert.deepEqual([...restored.simProgress.trailingPlayers],["HIDDEN_ID"]);
 assert.throws(()=>decryptRoom(cipher,Buffer.from(key(),"hex")));
 const parsed=JSON.parse(cipher);
 parsed.data=Buffer.from("tampered").toString("base64");
 assert.throws(()=>decryptRoom(JSON.stringify(parsed),rawKey));
});
test("opt-in encrypted snapshots are durable, filtered and removable",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"kingwar-recovery-")),config={directory:dir,key:key()};
 try{
  const src=example();
  assert.equal(await saveRoomSnapshot(src,config),true);
  const files=await readdir(dir);
  assert.equal(files.length,1);
  assert.ok(!files[0].includes(src.code));
  const bytes=await readFile(join(dir,files[0]),"utf8");
  assert.ok(!bytes.includes(src.players[0].name));
  const list=await loadRoomSnapshots(config);
  assert.equal(list.errors.length,0);
  assert.equal(list.rooms.length,1);
  assert.equal(list.rooms[0].players[0].hand[0].id,"CARD_SECRET");
  assert.equal(await removeRoomSnapshot(src.code,config),true);
  assert.equal((await loadRoomSnapshots(config)).rooms.length,0);
 } finally {await rm(dir,{recursive:true,force:true})}
});
test("snapshot saving refuses a plaintext secrets directory without an encryption key",()=>{
 assert.throws(()=>saveRoomSnapshot(example(),{directory:"/tmp/recovery-without-key",key:""}),/KW_STATE_KEY/);
});
