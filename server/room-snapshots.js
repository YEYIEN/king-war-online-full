import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SCHEMA = 1;
let queue = Promise.resolve();
/**
 * Opt-in encrypted snapshots. All player hands, deck order and reconnect
 * credentials are sensitive. Refuse persistence without a 32-byte AES key.
 * This is a SINGLE PROCESS crash-recovery prototype, not a distributed DB.
 */
function options({ directory=process.env.KW_STATE_DIR, key=process.env.KW_STATE_KEY }={}) {
  if(!directory)return null;
  if(!key || !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("KW_STATE_DIR requires a 64-character hexadecimal KW_STATE_KEY");
  }
  return { directory, key:Buffer.from(key,"hex") };
}
function filename(directory,code) {
 return join(directory,createHash("sha256").update(code).digest("hex")+".kwstate");
}
function serializeRoom(room) {
 const out={...room};
 delete out.simMetrics;
 out.simProgress=room.simProgress?{
   trailingPlayers:[...(room.simProgress.trailingPlayers||[])],
   criticalPlayers:[...(room.simProgress.criticalPlayers||[])]}:null;
 // Do not serialize ephemeral server socket/timeout object state.
 return {schema:SCHEMA,savedAt:Date.now(),room:out};
}
export function encryptRoom(room,key) {
 const iv=randomBytes(12);
 const cipher=createCipheriv("aes-256-gcm",key,iv);
 const content=Buffer.from(JSON.stringify(serializeRoom(room)),"utf8");
 const encrypted=Buffer.concat([cipher.update(content),cipher.final()]);
 return JSON.stringify({version:SCHEMA,iv:iv.toString("base64"),
  data:encrypted.toString("base64"),tag:cipher.getAuthTag().toString("base64")});
}
export function decryptRoom(contents,key) {
 const envelope=JSON.parse(contents);
 if(envelope?.version!==SCHEMA)throw new Error("Snapshot version mismatch");
 const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(envelope.iv,"base64"));
 decipher.setAuthTag(Buffer.from(envelope.tag,"base64"));
 const data=Buffer.concat([decipher.update(Buffer.from(envelope.data,"base64")),decipher.final()]);
 const decoded=JSON.parse(data.toString("utf8"));
 if(decoded.schema!==SCHEMA || typeof decoded.room?.code!=="string" ||
    !Array.isArray(decoded.room.players) ||
    !["lobby","playing","ended"].includes(decoded.room.status) ||
    decoded.room.players.length<1 || decoded.room.players.length>5)
   throw new Error("Invalid room snapshot");
 if(decoded.room.simProgress){
   decoded.room.simProgress={
     trailingPlayers:new Set(decoded.room.simProgress.trailingPlayers||[]),
     criticalPlayers:new Set(decoded.room.simProgress.criticalPlayers||[])};
 }
 return decoded.room;
}
function enqueue(task) {
 const next=queue.then(task,task);
 queue=next.catch(error=>console.error("Encrypted game snapshot error:",error.message));
 return next;
}
export function saveRoomSnapshot(room,config) {
 const o=options(config);
 if(!o || process.env.KW_SIMULATION==="1" || !room?.code)return Promise.resolve(false);
 const payload=encryptRoom(room,o.key), file=filename(o.directory,room.code);
 return enqueue(async()=>{
  await mkdir(o.directory,{recursive:true,mode:0o700});
  const temporary=join(o.directory,`.${randomUUID()}.tmp`);
  try{
   await writeFile(temporary,payload,{encoding:"utf8",mode:0o600,flag:"wx"});
   await rename(temporary,file);
  }finally{await rm(temporary,{force:true}).catch(()=>{});}
  return true;
 });
}
export function removeRoomSnapshot(roomCode,config) {
 const o=options(config);
 if(!o || process.env.KW_SIMULATION==="1")return Promise.resolve(false);
 return enqueue(async()=>{await rm(filename(o.directory,roomCode),{force:true});return true;});
}
export async function loadRoomSnapshots(config) {
 const o=options(config);
 if(!o || process.env.KW_SIMULATION==="1")return {rooms:[],errors:[]};
 let names=[];
 try{names=await readdir(o.directory);}catch(error){
  if(error.code==="ENOENT")return {rooms:[],errors:[]};throw error;
 }
 const rooms=[],errors=[];
 for(const name of names.filter(n=>n.endsWith(".kwstate"))){
  try{
   const raw=await readFile(join(o.directory,name),"utf8");
   const room=decryptRoom(raw,o.key);
   if(room.status==="ended")continue;
   if(filename(o.directory,room.code)!==join(o.directory,name))throw new Error("Snapshot filename mismatch");
   rooms.push(room);
  }catch(error){errors.push({file:name,error:error.message});}
 }
 return {rooms,errors};
}
