/**
 * Per-socket packet budget. This protects the single-process prototype from
 * oversized client events and fast request floods without changing legal moves.
 * Do not use as an IP-based abuse defense or a replacement for authentication.
 */
const CONTROL = new Set(["room:resume","room:create","room:join","matchmaking:join","singleplayer:start","tutorial:start"]);
const GAME = new Set(["game:deploy","game:recall","game:attackUnit","game:attackKing","game:castMagic","game:endTurn","game:lastStand","game:start"]);
const MAX_BYTES=4096;
export function makeSocketGuard({ now=Date.now, controlWindowMs=60_000, controlMax=20,
  gameWindowMs=10_000, gameMax=100 }={}) {
 const buckets=new Map();
 return function validate(packet) {
  if(!Array.isArray(packet)||typeof packet[0]!=="string"||packet[0].length>80)
    return {ok:false,error:"無效的事件格式。"};
  const name=packet[0];
  if(!name.startsWith("room:")&&!name.startsWith("game:")&&!name.startsWith("singleplayer:")&&
     !name.startsWith("matchmaking:")&&!name.startsWith("tutorial:")) return {ok:true};
  if(packet.length>3) return {ok:false,error:"事件參數過多。"};
  const payload=packet[1];
  if(payload!==undefined && payload!==null && (typeof payload!=="object" || Array.isArray(payload)))
    return {ok:false,error:"事件資料格式不正確。"};
  try { if(Buffer.byteLength(JSON.stringify(payload??{}),"utf8")>MAX_BYTES)
    return {ok:false,error:"事件資料超出大小限制。"}; }
  catch {return {ok:false,error:"無法解析事件資料。"};}
  const nowMs=now(),kind=CONTROL.has(name)?"control":GAME.has(name)?"game":"other";
  const window=kind==="control"?controlWindowMs:gameWindowMs;
  const max=kind==="control"?controlMax:kind==="game"?gameMax:50;
  const key=kind;
  const bucket=buckets.get(key);
  const current=!bucket||nowMs-bucket.start>=window?{start:nowMs,n:0}:bucket;
  current.n++;
  buckets.set(key,current);
  if(current.n>max)return {ok:false,error:"操作過於頻繁，請稍後再試。"};
  return {ok:true};
 };
}
export function guardSocket(socket, options) {
 const validate=makeSocketGuard(options);
 socket.use((packet,next)=>{
   const result=validate(packet);
   if(result.ok) {
     if(packet[1]===null)packet[1]={};
     return next();
   }
   const ack=packet.findLast(x=>typeof x==="function");
   if(ack)ack({ok:false,error:result.error});
   // Deliberately drop rejected event; the callback above prevents client hangs.
 });
}
