import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
import {mkdir,readFile,readdir,rename,unlink,writeFile} from "node:fs/promises";
import {join} from "node:path";

const directory=process.env.KW_RECOVERY_DIR||"";
const keyText=process.env.KW_RECOVERY_KEY||"";
const enabled=process.env.KW_SIMULATION!=="1" && !!directory && !!keyText;
const key=enabled && /^[a-f0-9]{64}$/i.test(keyText)?Buffer.from(keyText,"hex"):null;
if(enabled&&!key) throw new Error("KW_RECOVERY_KEY must be exactly 64 hexadecimal characters (32 bytes)");
const queues=new Map();
const ROOM_CODE=/^KW[A-HJ-NP-Z2-9]{6}$/;

export function encryptRoom(room,secret) {
 if(!Buffer.isBuffer(secret)||secret.length!==32)throw new Error("Invalid recovery secret");
 if(!ROOM_CODE.test(room?.code||""))throw new Error("Invalid recovery room code");
 const nonce=randomBytes(12);
 const cipher=createCipheriv("aes-256-gcm",secret,nonce);
 cipher.setAAD(Buffer.from(room.code));
 const raw=JSON.stringify(room,(field,value)=>
   ["socketId","simProgress","simMetrics"].includes(field)?undefined:value);
 const encrypted=Buffer.concat([cipher.update(raw,"utf8"),cipher.final()]);
 return Buffer.concat([nonce,cipher.getAuthTag(),encrypted]);
}
export function decryptRoom(data,secret,code) {
 if(!ROOM_CODE.test(code)||!Buffer.isBuffer(secret)||secret.length!==32||data.length<29)
  throw new Error("Invalid recovery input");
 const decipher=createDecipheriv("aes-256-gcm",secret,data.subarray(0,12));
 decipher.setAAD(Buffer.from(code));
 decipher.setAuthTag(data.subarray(12,28));
 const room=JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString("utf8"));
 if(room.code!==code||room.status!=="playing"||!Array.isArray(room.players)||
    room.players.length<2||room.players.length>5||!room.players.every(p=>p.id&&(p.isAI||p.resumeToken)&&Array.isArray(p.field)&&Array.isArray(p.hand)&&Array.isArray(p.magic)))
  throw new Error("Recovery state failed validation");
 room.players.forEach(p=>{p.socketId=null;p.connected=false;});
 room.simProgress={trailingPlayers:new Set(),criticalPlayers:new Set()};
 return room;
}
export function isRecoveryEnabled(){return !!key;}
export async function listRecoveredRooms(){
 if(!key)return [];
 let files;
 try{files=await readdir(directory)}catch(e){if(e.code==="ENOENT")return [];throw e;}
 const recovered=[];
 for(const filename of files.filter(f=>f.endsWith(".kwroom"))) {
  const code=filename.slice(0,-7);
  if(!ROOM_CODE.test(code))continue;
  try{
   const room=decryptRoom(await readFile(join(directory,filename)),key,code);
   recovered.push(room);
  }catch(e){console.error("Rejected invalid encrypted recovery snapshot:",e.message);}
 }
 return recovered;
}
async function performWrite(code,room){
 const filepath=join(directory,`${code}.kwroom`);
 if(room?.status!=="playing"){
  await unlink(filepath).catch(e=>{if(e.code!=="ENOENT")throw e;});
  return;
 }
 const encrypted=encryptRoom(room,key);
 await mkdir(directory,{recursive:true,mode:0o700});
 const temp=join(directory,`${code}.${randomBytes(6).toString("hex")}.tmp`);
 try{await writeFile(temp,encrypted,{mode:0o600});await rename(temp,filepath);}
 catch(error){await unlink(temp).catch(()=>{});throw error;}
}
export function queueRoomRecovery(room){
 if(!key||!room?.code||!ROOM_CODE.test(room.code))return Promise.resolve(false);
 // Clone the record *before* crossing the await boundary so the encrypted
 // snapshot corresponds to a coherent server state, not a mutable future state.
 const frozen=room.status==="playing"?structuredClone({
  ...room,simProgress:undefined,simMetrics:undefined,
  players:room.players.map(p=>({...p,socketId:undefined}))
 }):null;
 const pending=queues.get(room.code)||Promise.resolve();
 const next=pending.catch(()=>{}).then(()=>performWrite(room.code,frozen));
 queues.set(room.code,next);
 void next.catch(e=>console.error("Encrypted match recovery write failed:",e.message));
 return next;
}
export async function flushRoomRecovery(){
 await Promise.allSettled([...queues.values()]);
}
