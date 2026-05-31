
import express from "express";
import http from "http";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import path from "path";
import { fileURLToPath } from "url";

const PORT = process.env.PORT || 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const rooms = new Map();
let matchmakingRoomCode = null;

function cleanDisplayName(name) {
  const raw = String(name ?? "").normalize("NFKC").trim();
  const fallback = raw || "玩家";
  return Array.from(fallback).slice(0, 16).join("");
}

function asId(value) {
  return String(value ?? "");
}

function findPlayerByIdOrName(room, value) {
  const key = asId(value);
  return room.players.find((p) => p.id === key) || room.players.find((p) => p.name === key);
}

const TYPES = ["步兵", "弓兵", "法師", "騎兵"];
const RANKS = ["初級", "中級", "高級"];
const COUNTER = { 步兵: "弓兵", 弓兵: "法師", 法師: "騎兵", 騎兵: "步兵" };
const RANK_VALUE = { 初級: 1, 中級: 2, 高級: 3 };
const DAMAGE = { 初級: 1, 中級: 3, 高級: 5 };
const MAGIC_LEVEL_RANK = { 初級魔法: "初級", 中級魔法: "中級", 高級魔法: "高級" };

const KINGS = [
  { name: "亞歷山大大帝", effectName: "征服遠征", effect: "戰鬥消滅敵方兵種後抽1張兵種卡。" },
  { name: "屋大維奧古斯都", effectName: "羅馬秩序", effect: "非自己回合時，隨機1名我方場上兵種階級+1。" },
  { name: "成吉思汗", effectName: "草原機動", effect: "每回合可撤回1名我方兵種；若是騎兵，抽1張兵種卡。" },
  { name: "秦始皇", effectName: "中央集權", effect: "手牌上限9，每回合開始抽2張兵種卡。" },
  { name: "路易十四", effectName: "太陽王權", effect: "每回合第一次使用魔法卡後，抽1張兵種卡。" }
];

const MAGIC_DEFS = [
  { name: "火球術", count: 2, level: "初級魔法", target: "敵方", maxTargets: 1, text: "初級死亡；中高級階級-1。" },
  { name: "冰凍術", count: 2, level: "初級魔法", target: "敵方", maxTargets: 1, text: "暫停行動一回合；不可疊加。" },
  { name: "力量術", count: 3, level: "初級魔法", target: "我方", maxTargets: 1, text: "階級+1，並重置攻擊。" },
  { name: "虛弱術", count: 2, level: "中級魔法", target: "敵方", maxTargets: 1, text: "階級-1；若原本初級則不能攻擊。" },
  { name: "增強術", count: 2, level: "中級魔法", target: "我方", maxTargets: 1, text: "階級+1。" },
  { name: "流星雨", count: 1, level: "中級魔法", target: "敵方", maxTargets: 3, text: "指定1至3名敵方。初級死亡；中高級階級-1。" },
  { name: "毒藥瓶", count: 1, level: "高級魔法", target: "敵方", maxTargets: 1, text: "下回合死亡。" },
  { name: "燃血術", count: 1, level: "高級魔法", target: "我方", maxTargets: 1, text: "自己失去3生命；目標階級+1並重置攻擊。" },
  { name: "天殞術", count: 1, level: "高級魔法", target: "敵方全場", maxTargets: 0, text: "低於高級全部死亡；高級暫停行動一回合。" }
];

function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function makeUnits() {
  const counts = { 初級: 7, 中級: 5, 高級: 3 };
  const deck = [];
  for (const type of TYPES) for (const rank of RANKS) for (let i = 0; i < counts[rank]; i++) {
    deck.push({ id: nanoid(8), kind: "unit", name: `${rank}${type}`, type, rank, damage: DAMAGE[rank], counterTarget: COUNTER[type], tapped: false, justDeployed: false, archerBonusUsed: false, status: [] });
  }
  return shuffle(deck);
}

function makeMagic() {
  return shuffle(MAGIC_DEFS.flatMap(d => Array.from({ length: d.count }, () => ({ id: nanoid(8), kind: "magic", name: d.name, level: d.level, target: d.target, maxTargets: d.maxTargets, text: d.text }))));
}

const maxHand = p => p.king?.name === "秦始皇" ? 9 : 7;
function trimHand(room, p) {
  while (p.hand.length > maxHand(p)) {
    const c = p.hand.pop();
    room.unitDeck.push(c);
    room.log.push(`${p.name} 手牌超過上限，將 ${c.name} 放回牌堆底。`);
  }
}
function drawUnits(room, p, n) { for (let i=0;i<n && room.unitDeck.length;i++) p.hand.push(room.unitDeck.shift()); trimHand(room, p); }
function drawMagic(room, p, n) { let d=0; for (let i=0;i<n && room.magicDeck.length && p.magic.length<3;i++,d++) p.magic.push(room.magicDeck.shift()); return d; }
function alive(room) { return room.players.filter(p => !p.eliminated && p.hp > 0); }
function nextAlive(room, id) { const a=alive(room); const i=a.findIndex(p=>p.id===id); return a[(i+1)%a.length] || a[0]; }
function clearOct(p) { p.field.forEach(u => u.status = u.status.filter(s => s !== "屋大維+1")); }
function applyOct(room, p) {
  if (p.king?.name !== "屋大維奧古斯都") return;
  clearOct(p);
  const c = p.field.filter(u => !u.status.includes("屋大維+1"));
  if (!c.length) return;
  const u = c[Math.floor(Math.random()*c.length)];
  u.status.push("屋大維+1");
  room.log.push(`${p.name} 的屋大維效果：${u.name} 階級+1。`);
}
function startTurn(room, p) {
  clearOct(p);
  p.magicDrawUsed = false;
  p.recallUsed = false;
  p.fieldBonus = 0;
  p.field.forEach(u => {
    u.tapped = false; u.justDeployed = false; u.archerBonusUsed = false;
    u.status = u.status.filter(s => !["階級+1","階級-1","整備"].includes(s));
  });
  const ud = p.king?.name === "秦始皇" ? 2 : 1;
  drawUnits(room, p, ud);
  const mages = p.field.filter(u => u.type === "法師").length;
  const md = drawMagic(room, p, mages);
  room.log.push(`${p.name} 回合開始，抽${ud}張兵種卡${mages ? `，並因${mages}名法師抽${md}張魔法卡` : ""}。`);
}
function power(u) {
  let v = RANK_VALUE[u.rank];
  if (u.status.includes("階級+1")) v++;
  if (u.status.includes("屋大維+1")) v++;
  if (u.status.includes("整備")) v--;
  if (u.status.includes("階級-1")) v--;
  return v;
}
function canAttack(u) { return u && !u.tapped && !u.status.includes("不能攻擊") && !u.status.includes("整備") && !(u.justDeployed && u.type !== "騎兵"); }
function battle(a,d) {
  let av=power(a), dv=power(d);
  if (a.counterTarget === d.type) av++;
  if (d.counterTarget === a.type) dv++;
  if (av>dv) return "attacker"; if (dv>av) return "defender"; return "both";
}
function mageCanCast(m, magic) {
  if (!m || m.type !== "法師" || m.tapped || m.status.includes("不能攻擊")) return false;
  if (m.justDeployed && m.rank === MAGIC_LEVEL_RANK[magic.level]) return false;
  if (magic.level === "初級魔法") return ["初級","中級","高級"].includes(m.rank);
  if (magic.level === "中級魔法") return ["中級","高級"].includes(m.rank);
  if (magic.level === "高級魔法") return m.rank === "高級";
  return false;
}
function freeze(u) { if (!u.status.includes("不能攻擊")) u.status.push("不能攻擊"); }
function fireball(owner, id) { const i=owner.field.findIndex(u=>u.id===id); if(i<0)return; const u=owner.field[i]; if(u.rank==="初級") owner.field.splice(i,1); else u.status.push("階級-1"); }

function publicPlayer(p, viewer) {
  const isMe = p.id === viewer;
  return { id:p.id, name:p.name, isHost:p.isHost, connected:p.connected, hp:p.hp, king:p.king, field:p.field, hand:isMe?p.hand:[], magic:isMe?p.magic:[], handCount:p.hand.length, magicCount:p.magic.length, eliminated:p.eliminated };
}
function viewFor(room, viewer) { return { roomCode:room.code, hostId:room.hostId, maxPlayers:room.maxPlayers, status:room.status, currentPlayerId:room.currentPlayerId, log:room.log.slice(-50), players:room.players.map(p=>publicPlayer(p, viewer)) }; }
function broadcast(room) { room.players.forEach(p => io.to(p.socketId).emit("room:update", viewFor(room,p.id))); }
function findBySocket(sid) { for (const room of rooms.values()) { const p=room.players.find(x=>x.socketId===sid); if(p) return {room, player:p}; } return null; }
function code() { let c; do c=`KW${Math.floor(1000+Math.random()*9000)}`; while(rooms.has(c)); return c; }
function getPlayer(room,id){return room.players.find(p=>p.id===id);}
function requireTurn(room,p){return room.status==="playing" && room.currentPlayerId===p.id && !p.eliminated;}

function startGame(room) {
  room.status = "playing"; room.unitDeck = makeUnits(); room.magicDeck = makeMagic();
  const kings = shuffle(KINGS);
  room.players.forEach((p,i)=>{ p.hp=30; p.king=kings[i%kings.length]; p.field=[]; p.magic=[]; p.hand=[]; p.eliminated=false; p.magicDrawUsed=false; p.recallUsed=false; drawUnits(room,p,p.king.name==="秦始皇"?6:5); });
  room.currentPlayerId = room.players[0].id;
  room.log.push("遊戲開始：完整線上規則測試版 v1。");
  startTurn(room, room.players[0]);
}

io.on("connection", socket => {

  socket.on("matchmaking:join", ({ name }, reply) => {
    const playerName = cleanDisplayName(name);

    // 沒有等待中的隨機房：建立 2 人等待房
    if (!matchmakingRoomCode || !rooms.has(matchmakingRoomCode)) {
      const roomCode = code();
      const pid = nanoid(10);

      const p = {
        id: pid,
        socketId: socket.id,
        name: playerName,
        isHost: true,
        connected: true,
        hp: 30,
        king: null,
        hand: [],
        magic: [],
        field: [],
        eliminated: false
      };

      const room = {
        code: roomCode,
        hostId: pid,
        maxPlayers: 2,
        status: "lobby",
        matchmaking: true,
        players: [p],
        unitDeck: [],
        magicDeck: [],
        currentPlayerId: null,
        log: [`${p.name} 進入隨機匹配，等待另一位玩家。`]
      };

      rooms.set(roomCode, room);
      matchmakingRoomCode = roomCode;
      socket.join(roomCode);

      reply?.({ ok: true, playerId: pid, room: viewFor(room, pid), waiting: true });
      broadcast(room);
      return;
    }

    // 已有等待房：第二位玩家加入後自動開始
    const room = rooms.get(matchmakingRoomCode);

    if (!room || room.status !== "lobby" || room.players.length >= 2) {
      matchmakingRoomCode = null;
      return reply?.({ ok: false, error: "配對房間狀態異常，請再按一次隨機匹配。" });
    }

    const pid = nanoid(10);
    const p = {
      id: pid,
      socketId: socket.id,
      name: playerName,
      isHost: false,
      connected: true,
      hp: 30,
      king: null,
      hand: [],
      magic: [],
      field: [],
      eliminated: false
    };

    room.players.push(p);
    room.log.push(`${p.name} 加入隨機匹配，配對成功。`);
    socket.join(room.code);

    matchmakingRoomCode = null;
    startGame(room);

    reply?.({ ok: true, playerId: pid, room: viewFor(room, pid), waiting: false });
    broadcast(room);
  });


  socket.on("room:create", ({name,maxPlayers}, reply) => {
    const roomCode=code(), pid=nanoid(10);
    const p={id:pid,socketId:socket.id,name:String(name||"玩家").slice(0,16),isHost:true,connected:true,hp:30,king:null,hand:[],magic:[],field:[],eliminated:false};
    const room={code:roomCode,hostId:pid,maxPlayers:Math.max(2,Math.min(5,Number(maxPlayers)||2)),status:"lobby",players:[p],unitDeck:[],magicDeck:[],currentPlayerId:null,log:[`${p.name} 建立房間。`]};
    rooms.set(roomCode,room); socket.join(roomCode); reply?.({ok:true,playerId:pid,room:viewFor(room,pid)}); broadcast(room);
  });

  socket.on("room:join", ({name,code:roomCode}, reply) => {
    const room=rooms.get(String(roomCode||"").trim().toUpperCase());
    if(!room) return reply?.({ok:false,error:"找不到房間。"});
    if(room.status!=="lobby") return reply?.({ok:false,error:"遊戲已開始。"});
    if(room.players.length>=room.maxPlayers) return reply?.({ok:false,error:"房間已滿。"});
    const pid=nanoid(10), p={id:pid,socketId:socket.id,name:String(name||"玩家").slice(0,16),isHost:false,connected:true,hp:30,king:null,hand:[],magic:[],field:[],eliminated:false};
    room.players.push(p); room.log.push(`${p.name} 加入房間。`); socket.join(room.code); reply?.({ok:true,playerId:pid,room:viewFor(room,pid)}); broadcast(room);
  });

  socket.on("game:start", (_, reply) => {
    const f=findBySocket(socket.id); if(!f) return reply?.({ok:false,error:"你不在房間中。"});
    if(!f.player.isHost) return reply?.({ok:false,error:"只有房主可開始。"});
    if(f.room.players.length<2) return reply?.({ok:false,error:"至少需要2位玩家。"});
    startGame(f.room); reply?.({ok:true}); broadcast(f.room);
  });

  socket.on("game:deploy", ({cardId}, reply) => {
    const f=findBySocket(socket.id); if(!f) return; const {room,player:p}=f;
    if(!requireTurn(room,p)) return reply?.({ok:false,error:"還沒輪到你。"});
    const i=p.hand.findIndex(c=>c.id===cardId); if(i<0) return reply?.({ok:false,error:"找不到手牌。"});
    if(p.field.length>=5+(p.fieldBonus||0)) return reply?.({ok:false,error:"場上已滿。"});
    const [c]=p.hand.splice(i,1); c.justDeployed=true;
    if(c.rank==="高級"){c.status.push("整備"); c.tapped=true;} else c.tapped = c.type==="騎兵" ? false : true;
    p.field.push(c); room.log.push(`${p.name} 部署 ${c.name}${c.rank==="高級"?"，進入整備":""}。`); reply?.({ok:true}); broadcast(room);
  });

  socket.on("game:recall", ({unitId}, reply) => {
    const f=findBySocket(socket.id); if(!f) return; const {room,player:p}=f;
    if(!requireTurn(room,p)) return reply?.({ok:false,error:"還沒輪到你。"});
    if(p.king?.name!=="成吉思汗") return reply?.({ok:false,error:"只有成吉思汗可以撤回。"});
    if(p.recallUsed) return reply?.({ok:false,error:"本回合已撤回。"});
    const i=p.field.findIndex(u=>u.id===unitId); if(i<0)return reply?.({ok:false,error:"找不到兵種。"});
    const [u]=p.field.splice(i,1); u.tapped=false; u.justDeployed=false; p.hand.push(u); p.recallUsed=true;
    if(u.type==="騎兵") drawUnits(room,p,1);
    room.log.push(`${p.name} 撤回 ${u.name}${u.type==="騎兵"?"並抽1張兵種卡":""}。`); reply?.({ok:true}); broadcast(room);
  });

  socket.on("game:attackUnit", ({attackerId,targetPlayerId,defenderId}, reply) => {
    const f=findBySocket(socket.id); if(!f)return; const {room,player:p}=f;
    if(!requireTurn(room,p)) return reply?.({ok:false,error:"還沒輪到你。"});
    const target=getPlayer(room,targetPlayerId); if(!target || target.id===p.id || target.eliminated) return reply?.({ok:false,error:"目標玩家不合法。"});
    const ai=p.field.findIndex(u=>u.id===attackerId), di=target.field.findIndex(u=>u.id===defenderId);
    if(ai<0||di<0) return reply?.({ok:false,error:"找不到攻擊或防守兵種。"});
    const a=p.field[ai], d=target.field[di]; if(!canAttack(a)) return reply?.({ok:false,error:"這名兵種不能攻擊。"});
    const ap=power(a), dp=power(d), res=battle(a,d); a.tapped=true;
    let killed=false, archerSaved=false, archerExtra=false;
    if(a.type==="弓兵"){ if(dp<ap && !a.archerBonusUsed) archerExtra=true; if(dp>=ap){archerSaved=true; if(dp>ap) a.status.push("階級-1");}}
    if(res==="attacker"){target.field.splice(di,1); killed=true;} else if(res==="defender"){if(!archerSaved)p.field.splice(ai,1);} else {target.field.splice(di,1); killed=true; if(!archerSaved)p.field.splice(ai,1);}
    const survivor=p.field.find(u=>u.id===a.id); if(survivor && archerExtra){survivor.tapped=false; survivor.archerBonusUsed=true; room.log.push(`${survivor.name} 觸發弓兵額外攻擊。`);}
    if(killed && p.king?.name==="亞歷山大大帝"){drawUnits(room,p,1); room.log.push(`${p.name} 的亞歷山大效果：抽1張兵種卡。`);}
    room.log.push(`${p.name} 用 ${a.name} 攻擊 ${target.name} 的 ${d.name}。`); reply?.({ok:true}); broadcast(room);
  });

  socket.on("game:attackKing", ({attackerId,targetPlayerId}, reply) => {
    const f=findBySocket(socket.id); if(!f)return; const {room,player:p}=f;
    if(!requireTurn(room,p)) return reply?.({ok:false,error:"還沒輪到你。"});
    const target=getPlayer(room,targetPlayerId); if(!target||target.id===p.id||target.eliminated) return reply?.({ok:false,error:"目標玩家不合法。"});
    if(target.field.some(u=>u.type==="步兵")) return reply?.({ok:false,error:"目標場上仍有步兵，不能攻擊國王。"});
    const a=p.field.find(u=>u.id===attackerId); if(!canAttack(a)) return reply?.({ok:false,error:"這名兵種不能攻擊。"});
    target.hp-=a.damage; a.tapped=true; if(target.hp<=0){target.eliminated=true; room.log.push(`${target.name} 出局。`);}
    room.log.push(`${p.name} 用 ${a.name} 攻擊 ${target.name} 國王，造成${a.damage}傷害。`); reply?.({ok:true}); broadcast(room);
  });

  socket.on("game:castMagic", ({magicId,casterId,targetPlayerId,targetUnitIds}, reply) => {
    // 中文 ID 修正：統一魔法相關 ID，避免目標玩家或目標兵種比對失敗。
    magicId = asId(magicId);
    casterId = asId(casterId);
    targetPlayerId = asId(targetPlayerId);
    targetUnitIds = Array.isArray(targetUnitIds) ? targetUnitIds.map(asId) : [];

    const f=findBySocket(socket.id); if(!f)return; const {room,player:p}=f;
    if(!requireTurn(room,p)) return reply?.({ok:false,error:"還沒輪到你。"});
    const mi=p.magic.findIndex(m=>m.id===magicId), caster=p.field.find(u=>u.id===casterId);
    if(mi<0)return reply?.({ok:false,error:"找不到魔法卡。"}); const magic=p.magic[mi];
    if(!mageCanCast(caster,magic)) return reply?.({ok:false,error:"此法師不能施放這張魔法。"});
    const target=getPlayer(room,targetPlayerId); if(!target)return reply?.({ok:false,error:"找不到目標玩家。"});
    const ids=Array.isArray(targetUnitIds)?targetUnitIds:[];
    if(magic.name!=="天殞術"){
      if(ids.length<1) return reply?.({ok:false,error:"請至少指定1個目標。"});
      if(ids.length>magic.maxTargets) return reply?.({ok:false,error:`最多只能指定${magic.maxTargets}個目標。`});
      if(magic.target==="我方" && target.id!==p.id) return reply?.({ok:false,error:"此魔法只能指定我方。"});
      if(magic.target==="敵方" && target.id===p.id) return reply?.({ok:false,error:"此魔法只能指定敵方。"});
    } else if(target.id===p.id) return reply?.({ok:false,error:"天殞術只能指定敵方玩家。"});
    p.magic.splice(mi,1); caster.tapped=true; room.magicDeck.push(magic);
    if(magic.name==="天殞術"){
      const before=target.field.length; target.field=target.field.filter(u=>{ if(u.rank!=="高級") return false; freeze(u); return true; });
      room.log.push(`${p.name} 施放天殞術：${target.name} 低於高級死亡${before-target.field.length}名，高級暫停。`);
    } else {
      ids.forEach(id=>{
        const i=target.field.findIndex(u=>u.id===id); if(i<0)return; const u=target.field[i];
        if(magic.name==="火球術") fireball(target,id);
        if(magic.name==="冰凍術") freeze(u);
        if(magic.name==="力量術"){u.status.push("階級+1"); u.tapped=false;}
        if(magic.name==="虛弱術"){u.status.push("階級-1"); if(u.rank==="初級") freeze(u);}
        if(magic.name==="增強術") u.status.push("階級+1");
        if(magic.name==="毒藥瓶") u.status.push("下回合死亡");
        if(magic.name==="燃血術"){p.hp-=3; u.status.push("階級+1"); u.tapped=false;}
        if(magic.name==="流星雨") fireball(target,id);
      });
      room.log.push(`${p.name} 用 ${caster.name} 施放 ${magic.name}，指定${ids.length}個目標。`);
    }
    if(p.king?.name==="路易十四" && !p.magicDrawUsed){
  drawUnits(room,p,1);
  p.magicDrawUsed=true;
  room.log.push(`${p.name} 的路易十四效果：抽1張兵種卡。`);
}

// 修正：法師使用魔法視為一次攻擊。
// 如果力量術 / 燃血術指定到施法者自己，
// 前面的 u.tapped=false 會把法師重新解鎖，所以這裡要再鎖回去。
const usedCaster = p.field.find(u => u.id === casterId);
if (usedCaster) usedCaster.tapped = true;

reply?.({ok:true}); broadcast(room);
  });

  socket.on("game:endTurn", (_, reply) => {
    const f=findBySocket(socket.id); if(!f)return; const {room,player:p}=f;
    if(!requireTurn(room,p)) return reply?.({ok:false,error:"還沒輪到你。"});
    p.field=p.field.filter(u=>!u.status.includes("下回合死亡")); trimHand(room,p); applyOct(room,p);
    const a=alive(room); if(a.length<=1){room.status="ended"; room.log.push(`${a[0]?.name||"無人"} 獲勝！`); reply?.({ok:true}); broadcast(room); return;}
    const n=nextAlive(room,p.id); room.currentPlayerId=n.id; room.log.push(`${p.name} 結束回合。`); startTurn(room,n); reply?.({ok:true}); broadcast(room);
  });

  socket.on("disconnect", () => {
    const f = findBySocket(socket.id);
    if (!f) return;

    f.player.connected = false;
    f.room.log.push(`${f.player.name} 連線中斷。`);

    if (f.room.matchmaking && f.room.status === "lobby" && matchmakingRoomCode === f.room.code) {
      matchmakingRoomCode = null;
      rooms.delete(f.room.code);
      return;
    }

    broadcast(f.room);
  });
});

if (process.env.NODE_ENV === "production") {
  const dist = path.join(__dirname, "../client/dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}
server.listen(PORT, () => console.log(`King War Online Full running on http://localhost:${PORT}`));
