
import express from "express";
import http from "http";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import { applyMagicFieldEffect } from "./magic-effects.js";
import { nextLivingPlayer } from "./turn-order.js";
import { canUseLastStand, mitigateKingDamage } from "./comeback-rules.js";
import path from "path";
import { fileURLToPath } from "url";

const PORT = process.env.PORT || 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const rooms = new Map();
const turnTimers = new Map();
const roomCleanupTimers = new Map();
const disconnectGraceTimers = new Map();
let matchmakingRoomCode = null;

function cleanDisplayName(name) {
  const raw = String(name ?? "").normalize("NFKC").trim();
  const fallback = raw || `玩家${Math.floor(1000 + Math.random() * 9000)}`;
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
const AI_DIFFICULTIES = ["easy", "normal", "hard"];
function getAIDifficulty(room) { return AI_DIFFICULTIES.includes(room?.settings?.aiDifficulty) ? room.settings.aiDifficulty : "normal"; }
const MAGIC_LEVEL_RANK = { 初級魔法: "初級", 中級魔法: "中級", 高級魔法: "高級" };

const KINGS = [
  { name: "亞歷山大大帝", effectName: "征服遠征", effect: "戰鬥消滅敵方兵種後抽1張兵種卡。" },
  { name: "屋大維奧古斯都", effectName: "羅馬秩序", effect: "非自己回合時，隨機1名我方場上兵種戰力+1。" },
  { name: "成吉思汗", effectName: "草原機動", effect: "開局至少有1張騎兵；每回合可撤回1名我方兵種，前2次撤回騎兵時可額外抽1張兵種卡。" },
  { name: "秦始皇", effectName: "中央集權", effect: "手牌上限9，每回合開始抽2張兵種卡。" },
  { name: "路易十四", effectName: "太陽王權", effect: "場上有法師時每回合多抽1張魔法；首次施法後抽1張兵種，且施法法師可再行動一次。" }
];

const MAGIC_DEFS = [
  { name: "火球術", count: 3, level: "初級魔法", target: "敵方", maxTargets: 1, text: "初級死亡；中級、高級戰力-1。" },
  { name: "冰凍術", count: 2, level: "初級魔法", target: "敵方", maxTargets: 1, text: "初級、中級暫停行動一回合；高級改為戰力-1。不可疊加。" },
  { name: "力量術", count: 3, level: "初級魔法", target: "我方", maxTargets: 1, text: "我方一名兵種戰力+1，直到本回合結束；不能重置攻擊。" },
  { name: "虛弱術", count: 2, level: "中級魔法", target: "敵方", maxTargets: 1, text: "敵方一名兵種戰力-1；若目標目前戰力已是1，則不能攻擊一回合。" },
  { name: "增強術", count: 2, level: "中級魔法", target: "我方", maxTargets: 1, text: "我方一名兵種戰力+1，直到下次自己回合開始；若目標尚未行動，本回合攻擊國王傷害+1。" },
  { name: "流星雨", count: 1, level: "中級魔法", target: "敵方", maxTargets: 3, text: "指定1至3名敵方。初級死亡；中級、高級戰力-1。" },
  { name: "毒藥瓶", count: 1, level: "高級魔法", target: "敵方", maxTargets: 1, text: "指定敵方一名兵種，該兵種在其控制者下次回合結束時死亡。" },
  { name: "燃血術", count: 1, level: "高級魔法", target: "我方", maxTargets: 1, text: "自己失去3HP；我方一名兵種戰力+1並重置攻擊；若攻擊國王，額外造成1傷害。" },
  { name: "天殞術", count: 1, level: "高級魔法", target: "敵方全場", maxTargets: 0, text: "敵方場上低於高級的兵種全部死亡；高級兵種暫停行動一回合。" }
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
function openingTruce(room) { return (!!room?.settings?.openingTruceEnabled && (room.turnsCompleted || 0) < room.players.length) || (!!room?.settings?.firstSeatPeacefulTurn && room.players.length === 2 && (room.turnsCompleted || 0) === 0); }

function finishIfGameOver(room) {
  if (!room || room.status === "ended") return true;

  const living = alive(room);

  if (living.length <= 1) {
    clearTurnTimer(room);
    room.status = "ended";
    room.currentPlayerId = null;
    room.log.push(`${living[0]?.name || "無人"} 獲勝！`);

    // ROOM_CLEANUP_ON_GAME_OVER_V1
    // 結束後保留一段時間讓玩家看結果，之後刪除房間，避免舊房間污染新局。
    if (process.env.KW_SIMULATION !== "1") scheduleRoomCleanup(room, room.singleplayer || room.tutorial ? 45 : 180);

    return true;
  }

  return false;
}
function nextAlive(room, id) { return nextLivingPlayer(room.players, id); }
function clearOct(p) { p.field.forEach(u => u.status = u.status.filter(s => s !== "屋大維+1")); }
function applyOct(room, p) {
  if (p.king?.name !== "屋大維奧古斯都") return;
  clearOct(p);
  const c = p.field.filter(u => !u.status.includes("屋大維+1"));
  if (!c.length) return;
  const u = c[Math.floor(Math.random()*c.length)];
  u.status.push("屋大維+1");
  room.log.push(`${p.name} 的屋大維效果：${u.name} 戰力+1。`);
}
function startTurn(room, p) {
  clearOct(p);

  const hadEmptyFieldAtTurnStart = p.field.length === 0;
  p.reinforcementAvailable = hadEmptyFieldAtTurnStart;
  p.reinforcementUsed = false;

  if (hadEmptyFieldAtTurnStart) {
    room.log.push(`${p.name} 場上沒有兵種，獲得急援：本回合第一張部署的初級或中級兵種可以立刻攻擊。`);
  }

  p.magicDrawUsed = false;
  p.recallUsed = false;
  p.lastStandShield = 0;
  p.fieldBonus = 0;
  p.field.forEach(u => {
    u.tapped = false; u.justDeployed = false; u.archerBonusUsed = false;
    u.status = u.status.filter(s => !["階級+1","階級-1","整備","傷害+1","燃血+1傷害","急援"].includes(s));
  });
  const ud = p.king?.name === "秦始皇" ? 2 : 1;
  drawUnits(room, p, ud);
  const mages = p.field.filter(u => u.type === "法師").length;
  const md = drawMagic(room, p, mages);
  const louisBonus = p.king?.name === "路易十四" && mages > 0 && room.settings?.louisBonus !== false
    ? drawMagic(room, p, 1) : 0;
  if (louisBonus) room.log.push(`${p.name} 的太陽王權：額外補充1張魔法卡。`);
  room.log.push(`${p.name} 回合開始，抽${ud}張兵種卡${mages ? `，並因${mages}名法師抽${md}張魔法卡` : ""}。`);
  scheduleTurnTimer(room, p);

  // DISCONNECT_GRACE_STARTTURN_V1
  if (!p.connected && !p.isAI && room.status === "playing") {
    room.log.push(`${p.name} 目前斷線，開始 60 秒重連倒數。`);
    scheduleDisconnectGrace(room, p, 60);
  }
}
function rankValue(rank) {
  if (rank === "高級") return 3;
  if (rank === "中級") return 2;
  return 1;
}

function power(u) {
  let v = rankValue(u.rank);

  if (u.status.includes("整備")) v--;
  if (u.status.includes("階級-1")) v--;
  if (u.status.includes("階級+1")) v++;
  if (u.status.includes("力量術+1")) v++;
  if (u.status.includes("屋大維+1")) v++;

  return Math.max(1, v);
}
function effectiveDamage(unit) {
  let dmg = unit?.damage || 0;

  if (unit?.status?.includes("傷害+1")) dmg += 1;
  if (unit?.status?.includes("燃血+1傷害")) dmg += 1;

  return dmg;
}

function canAttack(u) {
  return !!u &&
    !u.tapped &&
    !u.status.includes("整備") &&
    !u.status.includes("不能攻擊") &&
    !u.status.includes("疲乏") &&
    !u.status.includes("疲乏待解");
}
function battle(a,d) {
  let av=power(a), dv=power(d);
  if (a.counterTarget === d.type) av++;
  if (d.counterTarget === a.type) dv++;
  if (av>dv) return "attacker"; if (dv>av) return "defender"; return "both";
}
function mageCanCast(m, magic) {
  if (!m || m.type !== "法師" || !canAttack(m)) return false;
  if (m.justDeployed && m.rank === MAGIC_LEVEL_RANK[magic.level]) return false;
  if (magic.level === "初級魔法") return ["初級","中級","高級"].includes(m.rank);
  if (magic.level === "中級魔法") return ["中級","高級"].includes(m.rank);
  if (magic.level === "高級魔法") return m.rank === "高級";
  return false;
}
function publicPlayer(p, viewer, room) {
  const isMe = p.id === viewer;
  return { id:p.id, name:p.name, lastStandUsed: !!p.lastStandUsed, lastStandShield: p.lastStandShield || 0, comebackAvailable: isMe ? canUseLastStand(room,p) : false, isHost:p.isHost, connected:p.connected, hp:p.hp, king:p.king, field:p.field, hand:isMe?p.hand:[], magic:isMe?p.magic:[], handCount:p.hand.length, magicCount:p.magic.length, eliminated:p.eliminated, isAI: !!p.isAI, ready: !!p.ready, reinforcementAvailable: !!p.reinforcementAvailable, reinforcementUsed: !!p.reinforcementUsed };
}
function viewFor(room, viewer) { return { roomCode:room.code, hostId:room.hostId, maxPlayers:room.maxPlayers, settings: room.settings || { turnTimeLimit: 0, aiDifficulty: "normal", comebackEnabled: true }, status:room.status, isPublic: !!room.isPublic, roomType: room.tutorial ? "操作教學" : room.isPublic ? "公開房間" : "私人房間",
    tutorial: !!room.tutorial, openingTruceActive: openingTruce(room), tutorialProgress: room.tutorial ? room.tutorialProgress || 0 : null, currentPlayerId:room.currentPlayerId, turnStartedAt: room.turnStartedAt || null, log:room.log.slice(-50), players:room.players.map(p=>publicPlayer(p, viewer, room)) }; }
function broadcast(room) { room.players.forEach(p => { if (!isAIPlayer(p)) io.to(p.socketId).emit("room:update", viewFor(room,p.id)); }); }
function findBySocket(sid) { for (const room of rooms.values()) { const p=room.players.find(x=>x.socketId===sid); if(p) return {room, player:p}; } return null; }


function kwConnectedHumans(room) {
  if (!room) return [];
  return room.players.filter(p => !p.isAI && p.connected && p.socketId);
}

function deleteRoomNow(roomCode, reason = "房間已清理。") {
  const room = rooms.get(roomCode);
  if (!room) return false;
  clearTurnTimer(room);
  clearRoomCleanup(room);
  for (const player of room.players) clearDisconnectGrace(room, player);
  if (matchmakingRoomCode === room.code) matchmakingRoomCode = null;
  io.in(room.code).emit("room:deleted", { reason });
  io.socketsLeave(room.code);
  rooms.delete(room.code);
  return true;
}

function kwDeleteRoomIfNoHumans(room, reason = "房間內已無真人玩家，房間已清理。") {
  if (!room?.code || !rooms.has(room.code)) return false;
  return kwConnectedHumans(room).length === 0 ? deleteRoomNow(room.code, reason) : false;
}

function detachSocketFromOtherRooms(sid, keepRoomCode = null) {
  if (!sid) return;
  for (const room of Array.from(rooms.values())) {
    if (keepRoomCode && room.code === keepRoomCode) continue;
    const departing = room.players.find(p => p.socketId === sid);
    if (!departing) continue;
    io.sockets.sockets.get(sid)?.leave(room.code);
    if (room.status === "playing") {
      clearDisconnectGrace(room, departing);
      forcePlayerDefeat(room, departing, "離開原本房間，視同投降。");
    } else {
      departing.socketId = null;
      departing.connected = false;
      room.players = room.players.filter(p => p.id !== departing.id);
      if (room.hostId === departing.id) {
        const successor = room.players.find(p => !p.isAI && p.connected);
        if (successor) {
          room.hostId = successor.id;
          room.players.forEach(p => { p.isHost = p.id === successor.id; });
        }
      }
    }
    if (kwDeleteRoomIfNoHumans(room, "玩家已切換房間，原房間已清理。")) continue;
    room.log.push(`${departing.name} 離開房間。`);
    broadcast(room);
  }
}
function code() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c;

  do {
    let suffix = "";
    for (let i = 0; i < 6; i++) {
      suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    c = `KW${suffix}`;
  } while (rooms.has(c));

  return c;
}

function getPlayer(room,id){return room.players.find(p=>p.id===id);}
function requireTurn(room,p){return room.status==="playing" && room.currentPlayerId===p.id && !p.eliminated;}

function clearTurnTimer(room) {
  if (!room?.code) return;
  const timer = turnTimers.get(room.code);
  if (timer) {
    clearTimeout(timer);
    turnTimers.delete(room.code);
  }
}

function clearRoomCleanup(room) {
  if (!room?.code) return;

  const timer = roomCleanupTimers.get(room.code);
  if (timer) {
    clearTimeout(timer);
    roomCleanupTimers.delete(room.code);
  }
}

function scheduleRoomCleanup(room, seconds = 120) {
  if (!room?.code) return;

  clearRoomCleanup(room);

  const delay = Math.max(5, Number(seconds) || 120) * 1000;

  const timer = setTimeout(() => {
    deleteRoomNow(room.code, "遊戲已結束，房間已自動清理。");
  }, delay);

  roomCleanupTimers.set(room.code, timer);
}

function disconnectKey(room, player) {
  return `${room?.code || "NO_ROOM"}:${player?.id || "NO_PLAYER"}`;
}

function clearDisconnectGrace(room, player) {
  const key = disconnectKey(room, player);
  const timer = disconnectGraceTimers.get(key);

  if (timer) {
    clearTimeout(timer);
    disconnectGraceTimers.delete(key);
  }
}

function scheduleDisconnectGrace(room, player, seconds = 60) {
  if (!room || !player) return;
  if (room.status !== "playing") return;
  if (player.isAI || player.eliminated || player.connected) return;

  clearDisconnectGrace(room, player);

  const key = disconnectKey(room, player);

  const timer = setTimeout(() => {
    const liveRoom = rooms.get(room.code);
    if (!liveRoom || liveRoom.status !== "playing") return;

    const livePlayer = liveRoom.players.find((p) => p.id === player.id);
    if (!livePlayer || livePlayer.connected || livePlayer.eliminated || livePlayer.isAI) return;

    liveRoom.log.push(`${livePlayer.name} 斷線超過 ${seconds} 秒，視同投降。`);

    forcePlayerDefeat(liveRoom, livePlayer, "斷線逾時，視同投降。");
    disconnectGraceTimers.delete(key);

    broadcast(liveRoom);
    scheduleAITurn(liveRoom);
  }, seconds * 1000);

  disconnectGraceTimers.set(key, timer);
}

// One end-of-turn path for humans, AI and countdown expiry.
function finishTurn(room, player, reason = "結束回合") {
  if (!room || !player || room.status !== "playing" ||
      room.currentPlayerId !== player.id || player.eliminated) return false;

  clearTurnTimer(room);
  clearEndOfTurnBuffs(player);
  clearEndTurnControl(player);
  advanceFatigue(player);
  player.field = player.field.filter(unit => !unit.status.includes("下回合死亡"));
  if (room.simMetrics) room.simMetrics.turnsByKing[player.king.name] = (room.simMetrics.turnsByKing[player.king.name] || 0) + 1;
  room.turnsCompleted = (room.turnsCompleted || 0) + 1;
  if (room.turnsCompleted === room.players.length && room.settings?.openingTruceEnabled) room.log.push("戰前部署結束：現在可以正式開始交戰。");
  trimHand(room, player);
  applyOct(room, player);

  if (finishIfGameOver(room)) {
    broadcast(room);
    return true;
  }

  const next = nextAlive(room, player.id);
  room.currentPlayerId = next.id;
  room.log.push(`${player.name} ${reason}。`);
  startTurn(room, next);
  broadcast(room);
  scheduleAITurn(room);
  return true;
}

function finishTimedOutTurn(room, player) {
  finishTurn(room, player, "時間到，系統自動結束回合");
}

function scheduleTurnTimer(room, player) {
  clearTurnTimer(room);

  if (!room || room.status !== "playing" || !player || player.eliminated) return;

  const seconds = Number(room.settings?.turnTimeLimit || 0);

  room.turnStartedAt = Date.now();

  if (!seconds || seconds <= 0) return;
  if (player.isAI) return;

  const timer = setTimeout(() => {
    const liveRoom = rooms.get(room.code);
    if (!liveRoom) return;

    const livePlayer = liveRoom.players.find((p) => p.id === player.id);
    finishTimedOutTurn(liveRoom, livePlayer);
  }, seconds * 1000);

  turnTimers.set(room.code, timer);
}

function allGuestsReady(room) {
  return room.players
    .filter((p) => p.id !== room.hostId && !p.isAI)
    .every((p) => p.ready);
}

// When self-damage eliminates the current player, do not leave the turn on a dead player.
function advanceAfterElimination(room, player) {
  if (finishIfGameOver(room)) return;
  if (room.currentPlayerId !== player.id) return;
  clearTurnTimer(room);
  const next = nextAlive(room, player.id);
  if (!next) return;
  room.currentPlayerId = next.id;
  room.log.push(`輪到 ${next.name} 行動。`);
  startTurn(room, next);
  broadcast(room);
  scheduleAITurn(room);
}

function forcePlayerDefeat(room, player, reason = "離開遊戲，視同投降。") {
  if (!room || !player || room.status !== "playing" || player.eliminated) return false;

  player.hp = 0;
  player.eliminated = true;
  player.connected = false;
  player.socketId = null;
  room.log.push(`${player.name} ${reason}`);

  advanceAfterElimination(room, player);
  broadcast(room);
  return true;
}

function useLastStand(room, player, mode = "assault") {
  if (!canUseLastStand(room, player)) return { ok: false, error: "目前尚未符合背水一戰條件，或已經使用過。" };
  if (!["assault", "defense"].includes(mode)) return { ok: false, error: "不支援的背水一戰策略。" };
  player.lastStandUsed = true;
  player.lastStandMode = mode;
  player.hp -= 2;
  player.lastStandShield = room.settings?.lastStandShieldEnabled === false ? 0 : (mode === "defense" ? 7 : 3);
  if (mode === "assault") {
    drawUnits(room, player, 2);
    player.reinforcementAvailable = true;
    player.reinforcementUsed = false;
  } else {
    drawUnits(room, player, 1);
  }
  room.lastStandCount = (room.lastStandCount || 0) + 1;
  if (!room.lastStandModes) room.lastStandModes = { assault: 0, defense: 0 };
  room.lastStandModes[mode]++;
  if (room.simMetrics) room.simMetrics.comebackUses[mode]++;
  room.log.push(mode === "assault"
    ? `${player.name} 選擇突圍：失去2HP、抽2兵種、獲得一次緊急部署，並獲得3點護盾。`
    : `${player.name} 選擇固守：失去2HP、抽1兵種、獲得7點護盾，保留資源等待下回合。`);
  return { ok: true, mode };
}

function startGame(room) {
  // ROOM_CLEANUP_CLEAR_ON_STARTGAME_V1
  clearRoomCleanup(room);
  room.status = "playing";
  room.turnsCompleted = 0;
  room.unitDeck = makeUnits();
  room.magicDeck = makeMagic();

  // 每一局開始時重新隨機玩家順序。
  // 注意：只改順序，不改玩家 id / socketId / hostId。
  room.players = shuffle(room.players);

  // 重新標記房主，避免 shuffle 後 isHost 顯示錯亂。
  room.players.forEach((p) => {
    p.isHost = p.id === room.hostId;
  });

  const kings = shuffle(KINGS);

  room.players.forEach((p, i) => {
    p.hp = 30;
    p.king = kings[i % kings.length];
    p.field = [];
    p.magic = [];
    p.hand = [];
    p.eliminated = false;
    p.magicDrawUsed = false;
    p.recallUsed = false;
    p.recallDrawCount = 0;
    p.fieldBonus = 0;
    p.lastStandUsed = false;
    p.lastStandMode = null;
    p.lastStandShield = 0;

    drawUnits(room, p, p.king.name === "秦始皇" && room.settings?.qinOpeningBonus === true ? 6 : 5);
    if (p.king.name === "成吉思汗" && room.settings?.genghisGuaranteedCavalry !== false && !p.hand.some(c => c.type === "騎兵")) {
      const i = room.unitDeck.findIndex(c => c.type === "騎兵");
      if (i >= 0 && p.hand.length) {
        const [cavalry] = room.unitDeck.splice(i, 1);
        const replaced = p.hand.pop();
        p.hand.push(cavalry);
        room.unitDeck.push(replaced);
      }
    }
  });

  // Experimental two-player seat compensation: one extra opening option for the second player.
  const secondSeatExtraCards = Math.min(2, Math.max(0, Number(room.settings?.secondSeatExtraCards ?? 0)));
  if (room.players.length === 2 && secondSeatExtraCards > 0) {
    drawUnits(room, room.players[1], secondSeatExtraCards);
    room.log.push(`雙人局後手補償：${room.players[1].name} 額外抽${secondSeatExtraCards}張兵種卡。`);
  }

  const firstPlayer = room.players[0];
  room.currentPlayerId = firstPlayer.id;

  room.log.push(
    `遊戲開始：本局玩家順序：${room.players.map((p) => p.name).join(" → ")}。${firstPlayer.name} 成為先手。`
  );

  startTurn(room, firstPlayer);
}



function isAIPlayer(player) {
  return !!player?.isAI;
}

function sleep(ms) {
  if (process.env.KW_SIMULATION === "1") return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scheduleAITurn(room) {
  if (process.env.KW_SIMULATION === "1") return;
  if (!room || room.status !== "playing") return;

  const current = room.players.find((p) => p.id === room.currentPlayerId);
  if (!isAIPlayer(current) || current.eliminated) return;

  setTimeout(() => {
    performAITurn(room.code).catch((error) => {
      console.error("AI turn error:", error);
    });
  }, 900);
}

function aiRankValue(rank) {
  if (rank === "高級") return 3;
  if (rank === "中級") return 2;
  return 1;
}

function aiCanAttack(unit) {
  return canAttack(unit);
}

function aiBattleResult(attacker, defender) {
  return battle(attacker, defender);
}

function aiDeployScore(card, ai, enemy) {
  let score = 0;

  const hasInfantry = ai.field.some((u) => u.type === "步兵");
  const hasMage = ai.field.some((u) => u.type === "法師");
  const enemyHasInfantry = enemy?.field?.some((u) => u.type === "步兵");
  const enemyHasMage = enemy?.field?.some((u) => u.type === "法師");

  if (card.type === "步兵" && !hasInfantry) score += 35;
  if (card.type === "法師" && !hasMage) score += 30;
  if (card.type === "騎兵" && enemyHasInfantry) score += 30;
  if (card.type === "弓兵" && enemyHasMage) score += 22;

  score += aiRankValue(card.rank) * 8;

  if (card.rank === "高級" && !hasInfantry) score -= 12;
  if (card.rank === "高級" && ai.field.length === 0) score -= 10;

  if (ai.field.length === 0) score += 12;
  if (ai.field.length <= 2) score += 6;

  return score;
}

function aiDeployUnits(room, ai, enemy) {
  const difficulty = getAIDifficulty(room);
  let deployLimit = difficulty === "easy" ? 1 : difficulty === "hard" ? (ai.field.length <= 2 ? 3 : 2) : (ai.field.length <= 2 ? 2 : 1);

  while (deployLimit > 0 && ai.hand.length > 0 && ai.field.length < 5) {
    const scored = ai.hand
      .map((card, index) => ({ card, index, score: aiDeployScore(card, ai, enemy) }))
      .sort((a, b) => b.score - a.score);

    const best = difficulty === "easy" ? scored[Math.floor(Math.random() * Math.min(3, scored.length))] : scored[0];
    if (!best || best.score < 8) break;

    const [card] = ai.hand.splice(best.index, 1);
    card.justDeployed = true;

    let triggeredReinforcement = false;

    if (card.rank === "高級") {
      card.status.push("整備");
      card.tapped = true;
    } else {
      card.tapped = card.type === "騎兵" ? false : true;

      if (ai.reinforcementAvailable && !ai.reinforcementUsed) {
        card.tapped = false;
        card.status.push("急援");
        ai.reinforcementUsed = true;
        triggeredReinforcement = true;
      }
    }

    ai.field.push(card);
    room.log.push(`${ai.name} 部署 ${card.name}${card.rank === "高級" ? "，進入整備" : ""}${triggeredReinforcement ? "，觸發急援，本回合可以攻擊" : ""}。`); // AI_VISIBILITY_DEPLOY_LOG
    deployLimit--;
  }
}

function aiAttackScore(attacker, enemy, defender) {
  let score = 0;

  if (!defender) {
    if (enemy.field.some((u) => u.type === "步兵")) return -999;
    score += 30 + attacker.damage * 8;
    if (enemy.hp <= attacker.damage) score += 200;
    return score;
  }

  const result = aiBattleResult(attacker, defender);
  const defenderRank = aiRankValue(defender.rank);

  if (defender.type === "步兵") score += 35;
  if (defender.rank === "高級") score += 30;
  if (defender.rank === "中級") score += 20;
  if (defender.rank === "初級") score += 10;

  if (attacker.counterTarget === defender.type) score += 18;
  if (defender.counterTarget === attacker.type) score -= 10;

  if (result === "attacker") score += 28;
  if (result === "both") score += 10;
  if (result === "defender") score -= 28;

  if (attacker.type === "弓兵") {
    if (power(defender) >= power(attacker)) score += 10;
    if (power(defender) < power(attacker)) score += 14;
  }

  score += defenderRank * 4;
  return score;
}


function aiSelectEnemy(room, ai) {
  const enemies = room.players.filter(p => p.id !== ai.id && !p.eliminated);
  if (!enemies.length) return null;
  const difficulty = getAIDifficulty(room);
  if (difficulty === "easy") return enemies[Math.floor(Math.random() * enemies.length)];
  if (difficulty === "normal" && room.players.length === 2) return enemies[0];
  const threat = p =>
    p.hp * 0.8 +
    p.field.reduce((sum, u) => sum + effectiveDamage(u) * (canAttack(u) ? 2 : 1), 0) +
    p.magic.length * (p.field.some(u => u.type === "法師") ? 3 : 0) -
    p.field.filter(u => u.type === "步兵").length * 4 +
    (room.players.length >= 3 && p.king?.name === "成吉思汗" ? Math.max(0, Number(room.settings?.genghisThreatWeight ?? 2)) * 2 : 0);
  return enemies.sort((a, b) => threat(b) - threat(a))[0];
}

function aiStrategicAttackScore(room, ai, attacker, enemy, defender) {
  const basic = aiAttackScore(attacker, enemy, defender);
  const difficulty = getAIDifficulty(room);
  if (difficulty === "easy" || (difficulty === "normal" && room.players.length === 2)) return basic;
  // In free-for-all games, pressuring the strongest remaining army is generally
  // more useful than finishing an already-weak opponent just because it is weak.
  const strategicThreat = room.players.length >= 3
    ? enemy.field.reduce((sum, unit) => sum + rankValue(unit.rank) * 6, 0) + enemy.magic.length * 5 + enemy.hp * 0.35 +
      (enemy.king?.name === "成吉思汗" ? Math.max(0, Number(room.settings?.genghisThreatWeight ?? 2)) * 4 : 0)
    : 0;
  if (difficulty === "normal") return basic + strategicThreat;
  if (!defender) {
    let result = basic + strategicThreat + (enemy.hp <= effectiveDamage(attacker) ? 200 : 18);
    if (attacker.type === "步兵" && ai.field.filter(u => u.type === "步兵").length === 1 && ai.hp < 12) result -= 55;
    return result;
  }
  const result = battle(attacker, defender);
  let value = basic + strategicThreat;
  if (defender.type === "步兵" && enemy.field.filter(u => u.type === "步兵").length === 1) {
    value += 55 + ai.field.filter(u => canAttack(u) && u.id !== attacker.id).length * 22;
  }
  if (defender.type === "法師" && enemy.magic.length) value += 35;
  if (defender.type === "騎兵" && canAttack(defender)) value += 16;
  if (result === "defender" && attacker.type !== "弓兵") value -= 85;
  if (result === "both" && attacker.rank === "高級" && defender.rank !== "高級") value -= 65;
  if (attacker.type === "步兵" && ai.field.filter(u => u.type === "步兵").length === 1 && ai.hp < 12 && result !== "attacker") value -= 60;
  return value;
}

function returnUnitToHand(room, player, unitId) {
  if (player.king?.name !== "成吉思汗") return { ok: false, error: "只有成吉思汗可以撤回。" };
  if (player.recallUsed) return { ok: false, error: "本回合已撤回。" };
  const index = player.field.findIndex(unit => unit.id === unitId);
  if (index < 0) return { ok: false, error: "找不到兵種。" };
  const [unit] = player.field.splice(index, 1);
  unit.tapped = false;
  unit.justDeployed = false;
  unit.archerBonusUsed = false;
  // A returned card must not carry spell buffs, poison or pending combat flags back into hand.
  unit.status = [];
  player.hand.push(unit);
  player.recallUsed = true;
  const drawBonus = unit.type === "騎兵" && (player.recallDrawCount || 0) < (room.settings?.genghisDrawLimit ?? 2);
  if (drawBonus) {
    drawUnits(room, player, 1);
    player.recallDrawCount = (player.recallDrawCount || 0) + 1;
  }
  trimHand(room, player);
  room.log.push(`${player.name} 撤回 ${unit.name}${drawBonus ? "並抽1張兵種卡" : ""}。`);
  return { ok: true, unitId, drawBonus };
}

function aiUseKingAbility(room, ai) {
  if (ai.king?.name !== "成吉思汗" || ai.recallUsed || ai.hand.length >= maxHand(ai)) return false;
  const difficulty = getAIDifficulty(room);
  if (difficulty === "easy") return false;
  const candidates = ai.field.filter(u => u.type === "騎兵" && u.tapped);
  if (!candidates.length) return false;
  if (ai.field.length < 3) return false;
  if (difficulty === "normal" && Math.random() > 0.35) return false;
  const unit = candidates.sort((a, b) => rankValue(b.rank) - rankValue(a.rank))[0];
  return returnUnitToHand(room, ai, unit.id).ok;
}

// Shared combat resolution for both human Socket.IO actions and AI decisions.
function resolveAttackUnit(room, attackerPlayer, defenderPlayer, attackerId, defenderId) {
  if (openingTruce(room)) return { ok: false, error: "戰前部署期間不可攻擊，請先安排兵種。" };
  if (!defenderPlayer || defenderPlayer.id === attackerPlayer.id || defenderPlayer.eliminated) {
    return { ok: false, error: "目標玩家不合法。" };
  }
  const ai = attackerPlayer.field.findIndex(u => u.id === attackerId);
  const di = defenderPlayer.field.findIndex(u => u.id === defenderId);
  if (ai < 0 || di < 0) return { ok: false, error: "找不到攻擊或防守兵種。" };
  const attacker = attackerPlayer.field[ai];
  const defender = defenderPlayer.field[di];
  if (!canAttack(attacker)) return { ok: false, error: "這名兵種不能攻擊。" };

  const attackerPower = power(attacker);
  const defenderPower = power(defender);
  const result = battle(attacker, defender);
  if (room.simMetrics) {
    room.simMetrics.unitAttacks++;
    if (result === "both") room.simMetrics.mutualKills++;
    if (result === "defender") room.simMetrics.failedTrades++;
  }
  attacker.tapped = true;

  const archerSaved = attacker.type === "弓兵" && defenderPower >= attackerPower;
  const archerExtra = attacker.type === "弓兵" && defenderPower < attackerPower && !attacker.archerBonusUsed;
  if (archerSaved && defenderPower > attackerPower && !attacker.status.includes("疲乏")) {
    attacker.status.push("疲乏");
  }

  const killedEnemy = result === "attacker" || result === "both";
  const killedAttacker = (result === "defender" || result === "both") && !archerSaved;
  if (killedEnemy) defenderPlayer.field.splice(di, 1);
  if (killedAttacker) attackerPlayer.field.splice(ai, 1);

  const survivor = attackerPlayer.field.find(u => u.id === attacker.id);
  if (survivor && archerExtra) {
    survivor.tapped = false;
    survivor.archerBonusUsed = true;
    room.log.push(`${survivor.name} 觸發弓兵額外攻擊。`);
  }

  if (killedEnemy && attackerPlayer.king?.name === "亞歷山大大帝") {
    drawUnits(room, attackerPlayer, 1);
    room.log.push(`${attackerPlayer.name} 的亞歷山大效果：抽1張兵種卡。`);
  }

  room.log.push(`${attackerPlayer.name} 用 ${attacker.name} 攻擊 ${defenderPlayer.name} 的 ${defender.name}。`);
  return { ok: true, killedEnemy, killedAttacker };
}

function resolveAttackKing(room, attackerPlayer, defenderPlayer, attackerId) {
  if (openingTruce(room)) return { ok: false, error: "戰前部署期間不可攻擊國王。" };
  if (!defenderPlayer || defenderPlayer.id === attackerPlayer.id || defenderPlayer.eliminated) {
    return { ok: false, error: "目標玩家不合法。" };
  }
  if (defenderPlayer.field.some(u => u.type === "步兵")) {
    return { ok: false, error: "目標場上仍有步兵，不能攻擊國王。" };
  }
  const attacker = attackerPlayer.field.find(u => u.id === attackerId);
  if (!canAttack(attacker)) return { ok: false, error: "這名兵種不能攻擊。" };

  const damage = mitigateKingDamage(defenderPlayer, effectiveDamage(attacker));
  defenderPlayer.hp -= damage;
  if (room.simMetrics) {
    room.simMetrics.kingAttacks++;
    room.simMetrics.kingDamage += damage;
    room.simMetrics.damageByKing[attackerPlayer.king.name] = (room.simMetrics.damageByKing[attackerPlayer.king.name] || 0) + damage;
  }
  attacker.tapped = true;
  room.log.push(`${attackerPlayer.name} 用 ${attacker.name} 攻擊 ${defenderPlayer.name} 國王，造成${damage}傷害。`);

  if (defenderPlayer.hp <= 0) {
    defenderPlayer.eliminated = true;
    room.log.push(`${defenderPlayer.name} 出局。`);
    finishIfGameOver(room);
  }
  return { ok: true, damage };
}

function aiResolveAttackUnit(room, ai, enemy, attackerId, defenderId) {
  return resolveAttackUnit(room, ai, enemy, attackerId, defenderId).ok;
}

function aiResolveAttackKing(room, ai, enemy, attackerId) {
  return resolveAttackKing(room, ai, enemy, attackerId).ok;
}

async function aiAttackPhase(room, ai, preferredEnemy) {
  if (openingTruce(room)) return;
  const difficulty = getAIDifficulty(room);
  let safety = 0;
  while (safety++ < 10 && room.status === "playing") {
    const attackers = ai.field.filter(u => aiCanAttack(u));
    if (!attackers.length) break;
    const enemies = room.players.filter(p => p.id !== ai.id && !p.eliminated);
    const targets = (difficulty !== "easy" && room.players.length > 2) || difficulty === "hard"
      ? enemies : [preferredEnemy].filter(p => p && !p.eliminated);
    const actions = [];
    for (const enemy of targets) for (const attacker of attackers) {
      if (!enemy.field.some(u => u.type === "步兵")) {
        actions.push({ type: "king", enemy, attackerId: attacker.id,
          score: aiStrategicAttackScore(room, ai, attacker, enemy, null) });
      }
      for (const defender of enemy.field) {
        actions.push({ type: "unit", enemy, attackerId: attacker.id, defenderId: defender.id,
          score: aiStrategicAttackScore(room, ai, attacker, enemy, defender) });
      }
    }
    actions.sort((a, b) => b.score - a.score);
    const options = difficulty === "easy" ? actions.slice(0, Math.min(actions.length, 4)) : actions;
    const chosen = difficulty === "easy" ? options[Math.floor(Math.random() * options.length)] : options[0];
    if (!chosen || chosen.score < (difficulty === "hard" ? 32 : difficulty === "easy" ? -15 : 5)) break;
    const result = chosen.type === "king"
      ? aiResolveAttackKing(room, ai, chosen.enemy, chosen.attackerId)
      : aiResolveAttackUnit(room, ai, chosen.enemy, chosen.attackerId, chosen.defenderId);
    if (!result) break;
    broadcast(room);
    await sleep(1900);
    if (room.currentPlayerId !== ai.id) break;
  }
}

// The only place where spell validation and effects are applied.
// AI chooses an action, while Socket.IO receives one from a human; both use this function.
function resolveMagic(room, player, { magicId, casterId, targetPlayerId, targetUnitIds = [] }) {
  magicId = asId(magicId);
  casterId = asId(casterId);
  targetPlayerId = asId(targetPlayerId);
  const ids = Array.isArray(targetUnitIds) ? targetUnitIds.map(asId) : [];

  const index = player.magic.findIndex(m => m.id === magicId);
  if (index < 0) return { ok: false, error: "找不到魔法卡。" };
  const magic = player.magic[index];
  const caster = player.field.find(u => u.id === casterId);
  if (!mageCanCast(caster, magic)) return { ok: false, error: "此法師不能施放這張魔法。" };

  const target = getPlayer(room, targetPlayerId);
  if (openingTruce(room) && magic.target !== "我方") return { ok: false, error: "戰前部署期間不能對敵人施放魔法。" };
  if (!target || target.eliminated) return { ok: false, error: "找不到有效的目標玩家。" };

  if (magic.target === "我方" && target.id !== player.id) {
    return { ok: false, error: "此魔法只能指定我方。" };
  }
  if (magic.target !== "我方" && target.id === player.id) {
    return { ok: false, error: "此魔法只能指定敵方。" };
  }

  // Validate all targets before consuming a card or the caster's action.
  if (magic.name === "天殞術") {
    if (ids.length !== 0) return { ok: false, error: "天殞術不需要指定個別兵種。" };
  } else {
    if (ids.length === 0) return { ok: false, error: "請至少指定1個目標。" };
    if (ids.length > magic.maxTargets) return { ok: false, error: `最多只能指定${magic.maxTargets}個目標。` };
    if (new Set(ids).size !== ids.length) return { ok: false, error: "不能重複指定同一兵種。" };
    if (ids.some(id => !target.field.some(unit => unit.id === id))) {
      return { ok: false, error: "指定的魔法目標已不存在，請重新選擇目標。" };
    }
  }

  if (room.simMetrics) room.simMetrics.spells[magic.name] = (room.simMetrics.spells[magic.name] || 0) + 1;
  player.magic.splice(index, 1);
  room.magicDeck.push(magic);
  caster.tapped = true;

  const { destroyed } = applyMagicFieldEffect(magic.name, target, ids);
  if (magic.name === "燃血術") {
    player.hp -= 3;
    if (player.hp <= 0) {
      player.eliminated = true;
      room.log.push(`${player.name} 因燃血術失去過多 HP，出局。`);
      finishIfGameOver(room);
    }
  }
  if (magic.name === "天殞術") {
    room.log.push(`${player.name} 施放天殞術：${target.name} 低於高級死亡${destroyed}名，高級暫停。`);
  } else {
    room.log.push(`${player.name} 用 ${caster.name} 施放 ${magic.name}，指定${ids.length}個目標。`);
  }

  const royalFirstSpell = player.king?.name === "路易十四" && !player.magicDrawUsed;
  if (royalFirstSpell) {
    drawUnits(room, player, 1);
    player.magicDrawUsed = true;
    room.log.push(`${player.name} 的路易十四效果：抽1張兵種卡。`);
  }
  // Experimental Louis buff removes the action cost only for the first spell.
  // This does not grant unlimited consecutive spell casts: the first-spell flag is consumed.
  caster.tapped = !(royalFirstSpell && room.settings?.louisFreeAction !== false);
  if (royalFirstSpell && !caster.tapped) room.log.push(`${caster.name} 因太陽王權可再次行動。`);
  if (player.eliminated) {
    advanceAfterElimination(room, player);
  }
  return { ok: true };
}

function aiMagicTargetValue(magic, unit) {
  const rank = rankValue(unit.rank);
  if (magic.name === "火球術" || magic.name === "流星雨") {
    return (rank === 1 ? 70 : 8 + rank * 4) + (unit.type === "步兵" ? 28 : 0);
  }
  if (magic.name === "冰凍術") return (canAttack(unit) ? 28 : 0) + (rank === 2 ? 34 : rank === 1 ? 22 : 8);
  if (magic.name === "虛弱術") return (canAttack(unit) ? 24 : 0) + rank * 16;
  if (magic.name === "毒藥瓶") return rank * 20 + (unit.type === "步兵" ? 18 : 0);
  return rank * 10;
}
function aiMagicCardValue(magic, ai, enemy) {
  const enemyUnits = enemy?.field || [];
  const attackReady = ai.field.filter(u => canAttack(u)).length;
  if (magic.name === "天殞術") return enemyUnits.filter(u => u.rank !== "高級").length * 42;
  if (magic.target === "敵方") {
    return Math.max(0, ...enemyUnits.map(unit => aiMagicTargetValue(magic, unit)));
  }
  if (magic.name === "燃血術" && ai.hp <= 10) return -1000;
  if (magic.name === "力量術") return attackReady ? 38 : -100;
  if (magic.name === "增強術") return attackReady ? 42 : -100;
  if (magic.name === "燃血術") return attackReady ? 48 : 8;
  return 10;
}

function aiChooseMagic(room, ai, enemy) {
  const mages = ai.field.filter(unit => unit.type === "法師" && canAttack(unit));
  if (!mages.length || !ai.magic.length) return false;

  const strategicMagic = getAIDifficulty(room) === "hard" && room.settings?.aiMagicStrategy !== false;
  const spells = [...ai.magic];
  if (strategicMagic) spells.sort((a,b) => aiMagicCardValue(b, ai, enemy) - aiMagicCardValue(a, ai, enemy));
  for (const magic of spells) {
    if (openingTruce(room) && magic.target !== "我方") continue;
    const caster = mages.find(unit => mageCanCast(unit, magic));
    if (!caster) continue;

    let target = enemy;
    let targets = [];
    if (magic.name === "天殞術") {
      const lowRankCount = enemy.field.filter(unit => unit.rank !== "高級").length;
      if (lowRankCount < 2 && enemy.field.length < 4) continue;
    } else if (magic.target === "我方") {
      target = ai;
      if (magic.name === "燃血術" && ai.hp <= 10) continue;
      const choices = [...ai.field].filter(unit => !unit.status.includes("整備") && (!strategicMagic || canAttack(unit) || magic.name === "燃血術"));
      choices.sort((a,b) => (strategicMagic ? (canAttack(b) ? 30 : 0) - (canAttack(a) ? 30 : 0) : 0) + aiRankValue(b.rank) - aiRankValue(a.rank));
      if (!choices.length) continue;
      targets = [choices[0].id];
    } else {
      const choices = [...enemy.field];
      if (["火球術","流星雨"].includes(magic.name)) {
        choices.sort((a,b) => ((b.type === "步兵" ? 20 : 0) + aiRankValue(b.rank) * 8) -
                               ((a.type === "步兵" ? 20 : 0) + aiRankValue(a.rank) * 8));
      } else {
        choices.sort((a,b) => aiRankValue(b.rank) - aiRankValue(a.rank));
      }
      if (strategicMagic) choices.sort((a, b) => aiMagicTargetValue(magic, b) - aiMagicTargetValue(magic, a));
      targets = choices.slice(0, magic.maxTargets || 1).map(unit => unit.id);
      if (!targets.length) continue;
    }

    const result = resolveMagic(room, ai, {
      magicId: magic.id,
      casterId: caster.id,
      targetPlayerId: target.id,
      targetUnitIds: targets
    });
    if (result.ok) return true;
  }
  return false;
}

function clearEndOfTurnBuffs(player) {
  player.field.forEach((u) => {
    u.status = u.status.filter((s) => s !== "力量術+1" && s !== "急援");
  });
}

function clearEndTurnControl(player) {
  player.field.forEach((u) => {
    u.status = u.status.filter((s) => s !== "不能攻擊");
  });
}

function advanceFatigue(player) {
  player.field.forEach((u) => {
    const nextStatus = [];

    for (const s of u.status) {
      if (s === "疲乏") {
        nextStatus.push("疲乏待解");
      } else if (s === "疲乏待解") {
        // 疲乏已經影響過一個自己的回合，移除
      } else {
        nextStatus.push(s);
      }
    }

    u.status = nextStatus;
  });
}

function aiEndTurn(room, ai) {
  return finishTurn(room, ai);
}

function isStillAITurn(room, ai) {
  return !!room &&
    !!ai &&
    room.status === "playing" &&
    room.currentPlayerId === ai.id &&
    !ai.eliminated &&
    isAIPlayer(ai);
}

async function performAITurn(roomCode) {
  const room = rooms.get(roomCode);
  if (!room || room.status !== "playing") return;

  const ai = room.players.find((p) => p.id === room.currentPlayerId);
  if (!isStillAITurn(room, ai)) return;

  const enemy = aiSelectEnemy(room, ai);

  if (!enemy) {
    finishIfGameOver(room);
    broadcast(room);
    return;
  }

  room.log.push(`${ai.name} 開始思考...`);
  broadcast(room);
  await sleep(1600);
  if (!isStillAITurn(room, ai)) return;

  room.log.push(`${ai.name} 正在檢查手牌與場面。`);
  broadcast(room);
  await sleep(1400);
  if (!isStillAITurn(room, ai)) return;

  if (getAIDifficulty(room) !== "easy" && canUseLastStand(room, ai) &&
      (getAIDifficulty(room) === "hard" || ai.hand.length < 3)) {
    useLastStand(room, ai, ai.hp <= 8 && (ai.field.length >= 1 || ai.hand.length >= 3) ? "defense" : "assault");
    broadcast(room);
  }
  const beforeDeployCount = ai.field.length;
  aiDeployUnits(room, ai, enemy);
  if (room.simMetrics) room.simMetrics.aiDeployments += Math.max(0, ai.field.length - beforeDeployCount);
  if (ai.field.length !== beforeDeployCount) {
    broadcast(room);
    await sleep(2100);
    if (!isStillAITurn(room, ai)) return;
  }

  if (!isStillAITurn(room, ai)) return;

  let usedMagic = aiChooseMagic(room, ai, enemy);
  if (getAIDifficulty(room) === "hard" && isStillAITurn(room, ai)) {
    let casts = 0;
    while (casts++ < 2 && aiSelectEnemy(room, ai) && aiChooseMagic(room, ai, aiSelectEnemy(room, ai))) usedMagic = true;
  }
  if (usedMagic) {
    broadcast(room);
    await sleep(2100);
    if (!isStillAITurn(room, ai)) return;
  }

  if (!isStillAITurn(room, ai)) return;

  room.log.push(`${ai.name} 進入攻擊階段。`);
  broadcast(room);
  await sleep(1400);
  if (!isStillAITurn(room, ai)) return;

  await aiAttackPhase(room, ai, enemy);

  if (room.status === "ended") {
    broadcast(room);
    return;
  }

  if (!isStillAITurn(room, ai)) return;

  if (aiUseKingAbility(room, ai)) {
    if (room.simMetrics) room.simMetrics.mongolRecalls++;
    broadcast(room);
  }
  room.log.push(`${ai.name} 準備結束回合。`);
  broadcast(room);
  await sleep(1600);
  if (!isStillAITurn(room, ai)) return;

  aiEndTurn(room, ai);
}


io.on("connection", socket => {


  socket.on("room:resume", ({ roomCode, playerId, resumeToken } = {}, reply) => {
    // ROOM_RESUME_REJECT_ENDED_V1
    const codeText = String(roomCode || "").trim().toUpperCase();
    const pid = String(playerId || "");

    const room = rooms.get(codeText);
    if (!room) return reply?.({ ok: false, error: "找不到原本房間。" });

    const player = room.players.find((p) => p.id === pid);
    if (!player) return reply?.({ ok: false, error: "找不到原本玩家。" });
    if (!player.resumeToken || typeof resumeToken !== "string" || resumeToken !== player.resumeToken) return reply?.({ ok: false, error: "重連憑證無效，請重新加入房間。" });
    if (room.status === "ended") return reply?.({ ok: false, error: "對局已結束，無法重新加入。" });
    if (player.isAI || player.eliminated) return reply?.({ ok: false, error: "此玩家無法重新加入。" });
    if (player.connected && player.socketId !== socket.id && io.sockets.sockets.has(player.socketId)) {
      return reply?.({ ok: false, error: "此玩家目前仍在線上。" });
    }

    detachSocketFromOtherRooms(socket.id, room.code);
    player.socketId = socket.id;
    player.connected = true;
    socket.join(room.code);

    // DISCONNECT_GRACE_RESUME_V1
    clearDisconnectGrace(room, player);

    room.log.push(`${player.name} 已重新連線。`);

    reply?.({ ok: true, playerId: player.id, resumeToken: player.resumeToken, room: viewFor(room, player.id) });
    broadcast(room);
  });


  socket.on("room:leave", (_, reply) => {
    const f = findBySocket(socket.id);
    if (!f) return reply?.({ ok: true });

    const { room, player } = f;

    // Exit the Socket.IO room for both active games and lobbies.
    clearDisconnectGrace(room, player);
    socket.leave(room.code);

    if (room.status === "playing") {
      forcePlayerDefeat(room, player, "回到主選單，視同投降.");
    } else {
      player.connected = false;
      player.socketId = null;
      room.players = room.players.filter(p => p.id !== player.id);
      socket.leave(room.code);
      if (room.hostId === player.id) {
        const successor = room.players.find(p => !p.isAI && p.connected);
        if (successor) {
          room.hostId = successor.id;
          room.players.forEach(p => { p.isHost = p.id === successor.id; });
        }
      }
      if (kwDeleteRoomIfNoHumans(room, "最後一位真人玩家已離開，房間已清理。")) {
        return reply?.({ ok: true });
      }
      room.log.push(`${player.name} 離開房間。`);
      broadcast(room);
    }

    reply?.({ ok: true });
  });

  socket.on("singleplayer:start", ({ name, difficulty = "normal" }, reply) => {
    detachSocketFromOtherRooms(socket.id);

    const roomCode = code();
    const humanId = nanoid(10);
    const aiId = nanoid(10);

    const human = {
      id: humanId,
      socketId: socket.id,
        resumeToken: nanoid(32),
      name: typeof cleanDisplayName === "function" ? cleanDisplayName(name) : String(name || "玩家").slice(0, 16),
      isHost: true,
      connected: true,
      hp: 30,
      king: null,
      hand: [],
      magic: [],
      field: [],
      eliminated: false
    };

    const ai = {
      id: aiId,
      socketId: "AI_" + aiId,
      name: "訓練騎士",
      isHost: false,
      isAI: true,
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
      hostId: humanId,
      maxPlayers: 2,
      status: "lobby",
      singleplayer: true,
      settings: { turnTimeLimit: 0, aiDifficulty: AI_DIFFICULTIES.includes(difficulty) ? difficulty : "normal" },
      players: [human, ai],
      unitDeck: [],
      magicDeck: [],
      currentPlayerId: null,
      log: [`${human.name} 開始單人模式，AI 對手：訓練騎士。`]
    };

    rooms.set(roomCode, room);
    socket.join(roomCode);

    startGame(room);

    reply?.({ ok: true, playerId: humanId, resumeToken: human.resumeToken, room: viewFor(room, humanId) });
    broadcast(room);
    scheduleAITurn(room);
  });




  socket.on("tutorial:start", ({ name }, reply) => {
    detachSocketFromOtherRooms(socket.id);

    const roomCode = code();
    const pid = nanoid(10);
    const aiId = nanoid(10);

    const unitDeck = makeUnits();
    const magicDeck = makeMagic();

    function takeCard(deck, cardName) {
      const index = deck.findIndex((card) => card.name === cardName);
      if (index >= 0) return deck.splice(index, 1)[0];

      return {
        id: nanoid(8),
        kind: "unit",
        name: cardName,
        type: cardName.includes("騎兵") ? "騎兵" :
              cardName.includes("法師") ? "法師" :
              cardName.includes("弓兵") ? "弓兵" : "步兵",
        rank: cardName.includes("高級") ? "高級" :
              cardName.includes("中級") ? "中級" : "初級",
        damage: cardName.includes("高級") ? 3 :
                cardName.includes("中級") ? 2 : 1,
        counterTarget:
              cardName.includes("步兵") ? "弓兵" :
              cardName.includes("弓兵") ? "法師" :
              cardName.includes("法師") ? "騎兵" : "步兵",
        tapped: false,
        justDeployed: false,
        archerBonusUsed: false,
        status: []
      };
    }

    function takeMagic(deck, magicName) {
      const index = deck.findIndex((card) => card.name === magicName);
      if (index >= 0) return deck.splice(index, 1)[0];

      return {
        id: nanoid(8),
        kind: "magic",
        name: magicName,
        level: "初級魔法",
        target: "我方",
        maxTargets: 1,
        text: "我方一名兵種戰力+1，直到本回合結束。"
      };
    }

    const player = {
      id: pid,
      socketId: socket.id,
        resumeToken: nanoid(32),
      name: cleanDisplayName(name),
      isHost: true,
      connected: true,
      ready: true,
      hp: 30,
      king: KINGS.find((k) => k.name === "亞歷山大大帝") || KINGS[0],
      hand: [takeCard(unitDeck, "中級騎兵")],
      magic: [takeMagic(magicDeck, "力量術")],
      field: [takeCard(unitDeck, "初級法師")],
      eliminated: false,
      magicDrawUsed: false,
      recallUsed: false,
      fieldBonus: 0,
      reinforcementAvailable: false,
      reinforcementUsed: false
    };

    const ai = {
      id: aiId,
      socketId: "AI_TUTORIAL_" + aiId,
      name: "教學對手",
      isHost: false,
      isAI: true,
      connected: true,
      ready: true,
      hp: 30,
      king: KINGS.find((k) => k.name === "凱撒") || KINGS[1] || KINGS[0],
      hand: [],
      magic: [],
      field: [takeCard(unitDeck, "中級弓兵")],
      eliminated: false,
      magicDrawUsed: false,
      recallUsed: false,
      fieldBonus: 0,
      reinforcementAvailable: false,
      reinforcementUsed: false
    };

    const room = {
      code: roomCode,
      hostId: pid,
      maxPlayers: 2,
      status: "playing",
      isPublic: false,
      tutorial: true,
      tutorialProgress: 0,
      matchmaking: false,
      singleplayer: false,
      settings: { turnTimeLimit: 0, aiDifficulty: "normal", comebackEnabled: true },
      players: [player, ai],
      unitDeck,
      magicDeck,
      currentPlayerId: pid,
      turnStartedAt: Date.now(),
      log: [
        "操作教學開始：這是一個固定教學房，請照正式對戰畫面完成部署、攻擊、施法與結束回合。",
        "教學提示：先部署中級騎兵，再用力量術強化它，才能安全擊敗中級弓兵。"
      ]
    };

    rooms.set(roomCode, room);
    socket.join(roomCode);

    reply?.({
      ok: true,
      playerId: pid,
      resumeToken: player.resumeToken,
      room: viewFor(room, pid)
    });

    broadcast(room);
  });

  socket.on("matchmaking:join", ({ name }, reply) => {
    detachSocketFromOtherRooms(socket.id);

    const playerName = cleanDisplayName(name);

    let room = Array.from(rooms.values()).find((candidate) =>
      candidate.status === "lobby" &&
      candidate.isPublic === true &&
      !candidate.singleplayer &&
      candidate.players.length < candidate.maxPlayers
    );

    const pid = nanoid(10);

    if (!room) {
      const roomCode = code();

      const player = {
        id: pid,
        socketId: socket.id,
        resumeToken: nanoid(32),
        name: playerName,
        isHost: true,
        connected: true,
        ready: true,
        hp: 30,
        king: null,
        hand: [],
        magic: [],
        field: [],
        eliminated: false
      };

      room = {
        code: roomCode,
        hostId: pid,
        maxPlayers: 2,
        status: "lobby",
        settings: { turnTimeLimit: 0, aiDifficulty: "normal", comebackEnabled: true },
        isPublic: true,
        matchmaking: true,
        singleplayer: false,
        players: [player],
        unitDeck: [],
        magicDeck: [],
        currentPlayerId: null,
        log: [`${player.name} 建立公開隨機匹配房間。房間代碼：${roomCode}`]
      };

      rooms.set(roomCode, room);
      socket.join(roomCode);

      reply?.({
        ok: true,
        playerId: pid,
        resumeToken: player.resumeToken,
        room: viewFor(room, pid),
        waiting: true
      });

      broadcast(room);
      return;
    }

    const player = {
      id: pid,
      socketId: socket.id,
        resumeToken: nanoid(32),
      name: playerName,
      isHost: false,
      connected: true,
      ready: false,
      hp: 30,
      king: null,
      hand: [],
      magic: [],
      field: [],
      eliminated: false
    };

    room.players.push(player);
    room.log.push(`${player.name} 加入公開隨機匹配房間。房間代碼：${room.code}`);
    socket.join(room.code);

    reply?.({
      ok: true,
      playerId: pid,
      resumeToken: player.resumeToken,
      room: viewFor(room, pid),
      waiting: false
    });

    broadcast(room);
  });

  socket.on("room:create", ({ name, maxPlayers }, reply) => {
    detachSocketFromOtherRooms(socket.id);

    const roomCode = code();
    const pid = nanoid(10);

    const player = {
      id: pid,
      socketId: socket.id,
        resumeToken: nanoid(32),
      name: cleanDisplayName(name),
      isHost: true,
      connected: true,
      ready: true,
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
      maxPlayers: Math.min(5, Math.max(2, Number(maxPlayers) || 2)),
      status: "lobby",
      settings: { turnTimeLimit: 0, aiDifficulty: "normal", comebackEnabled: true },
      isPublic: false,
      matchmaking: false,
      singleplayer: false,
      players: [player],
      unitDeck: [],
      magicDeck: [],
      currentPlayerId: null,
      log: [`${player.name} 建立私人房間。只有知道房間代碼的玩家可以加入。`]
    };

    rooms.set(roomCode, room);
    socket.join(roomCode);

    reply?.({
      ok: true,
      playerId: pid,
      resumeToken: player.resumeToken,
      room: viewFor(room, pid)
    });
  });

  socket.on("room:join", ({name,code:roomCode}, reply) => {
    detachSocketFromOtherRooms(socket.id);

    const room=rooms.get(String(roomCode||"").trim().toUpperCase());
    if(!room) return reply?.({ok:false,error:"找不到房間。"});
    if(room.status!=="lobby") return reply?.({ok:false,error:"遊戲已開始。"});
    if(room.players.length>=room.maxPlayers) return reply?.({ok:false,error:"房間已滿。"});
    const pid=nanoid(10), p={id:pid,socketId:socket.id,resumeToken:nanoid(32),name:cleanDisplayName(name),isHost:false,connected:true,ready:false,hp:30,king:null,hand:[],magic:[],field:[],eliminated:false};
    room.players.push(p); room.log.push(`${p.name} 加入房間。`); socket.join(room.code); reply?.({ok:true,playerId:pid,resumeToken:p.resumeToken,room:viewFor(room,pid)}); broadcast(room);
  });


  socket.on("room:toggleReady", (_, reply) => {
    const found = findBySocket(socket.id);
    if (!found) return reply?.({ ok: false, error: "你不在房間中。" });
    const { room, player } = found;
    if (room.status !== "lobby") return reply?.({ ok: false, error: "遊戲開始後不能變更準備狀態。" });
    if (player.isAI || player.id === room.hostId) return reply?.({ ok: false, error: "此玩家不需要變更準備狀態。" });

    player.ready = !player.ready;
    room.log.push(`${player.name} ${player.ready ? "已準備" : "取消準備"}。`);
    reply?.({ ok: true, ready: player.ready });
    broadcast(room);
  });

  socket.on("game:rematch", (_, reply) => {
    // REMATCH_FULLY_DISABLED_CLEAN_V1
    return reply?.({
      ok: false,
      error: "再來一局已停用。遊戲結束後會自動回到主選單。"
    });
  });

  socket.on("room:updateSettings", ({ maxPlayers, turnTimeLimit, aiDifficulty, comebackEnabled, openingTruceEnabled, fairOpening2P }, reply) => {
    const f = findBySocket(socket.id);
    if (!f) return reply?.({ ok: false, error: "你不在房間中。" });

    const { room, player } = f;

    if (room.status !== "lobby") {
      return reply?.({ ok: false, error: "遊戲開始後不能調整房間設定。" });
    }

    if (player.id !== room.hostId && !player.isHost) {
      return reply?.({ ok: false, error: "只有房主可以調整房間設定。" });
    }

    if (!room.settings) room.settings = { turnTimeLimit: 0 };

    if (maxPlayers !== undefined) {
      const nextMax = Math.min(5, Math.max(2, Number(maxPlayers) || 2));

      if (nextMax < room.players.length) {
        return reply?.({
          ok: false,
          error: `目前房間已有 ${room.players.length} 位玩家，不能調成 ${nextMax} 人。`
        });
      }

      room.maxPlayers = nextMax;
    }

    if (aiDifficulty !== undefined) {
      if (!AI_DIFFICULTIES.includes(aiDifficulty)) return reply?.({ ok: false, error: "不支援的 AI 難度。" });
      room.settings.aiDifficulty = aiDifficulty;
    }

    if (fairOpening2P !== undefined) {
      if (typeof fairOpening2P !== "boolean") return reply?.({ ok: false, error: "雙人公平開局設定無效。" });
      room.settings.firstSeatPeacefulTurn = fairOpening2P;
      room.settings.secondSeatExtraCards = fairOpening2P ? 1 : 0;
    }

    if (openingTruceEnabled !== undefined) {
      if (typeof openingTruceEnabled !== "boolean") return reply?.({ ok: false, error: "戰前部署設定必須為布林值。" });
      room.settings.openingTruceEnabled = openingTruceEnabled;
    }

    if (comebackEnabled !== undefined) {
      if (typeof comebackEnabled !== "boolean") return reply?.({ ok: false, error: "逆轉機制設定必須為布林值。" });
      room.settings.comebackEnabled = comebackEnabled;
    }

    if (turnTimeLimit !== undefined) {
      const allowed = [0, 30, 60, 120];
      const nextLimit = Number(turnTimeLimit);

      if (!allowed.includes(nextLimit)) {
        return reply?.({ ok: false, error: "不支援的回合時間限制。" });
      }

      room.settings.turnTimeLimit = nextLimit;
    }

    room.log.push(`${player.name} 更新了房間設定。`);

    reply?.({ ok: true });
    broadcast(room);
  });

  socket.on("room:addAI", (_, reply) => {
    const f = findBySocket(socket.id);
    if (!f) return reply?.({ ok: false, error: "你不在房間中。" });

    const { room, player } = f;

    if (room.status !== "lobby") {
      return reply?.({ ok: false, error: "遊戲開始後不能添加機器人。" });
    }

    if (player.id !== room.hostId) {
      return reply?.({ ok: false, error: "只有房主可以添加機器人。" });
    }

    if (room.players.length >= room.maxPlayers) {
      return reply?.({ ok: false, error: "房間人數已滿。" });
    }

    const aiNumber = room.players.filter((p) => p.isAI).length + 1;
    const aiId = nanoid(10);

    const ai = {
      id: aiId,
      socketId: "AI_" + aiId,
      name: `訓練騎士${aiNumber}`,
      isHost: false,
      isAI: true,
      connected: true,
      ready: true,
      hp: 30,
      king: null,
      hand: [],
      magic: [],
      field: [],
      eliminated: false
    };

    room.players.push(ai);
    room.log.push(`${player.name} 添加了機器人：${ai.name}。`);

    reply?.({ ok: true });
    broadcast(room);
  });

  socket.on("room:removeAI", (_, reply) => {
    const f = findBySocket(socket.id);
    if (!f) return reply?.({ ok: false, error: "你不在房間中。" });

    const { room, player } = f;

    if (room.status !== "lobby") {
      return reply?.({ ok: false, error: "遊戲開始後不能刪除機器人。" });
    }

    if (player.id !== room.hostId) {
      return reply?.({ ok: false, error: "只有房主可以刪除機器人。" });
    }

    const aiIndex = [...room.players]
      .map((p, index) => ({ p, index }))
      .reverse()
      .find((item) => item.p.isAI)?.index;

    if (aiIndex === undefined) {
      return reply?.({ ok: false, error: "目前沒有機器人可以刪除。" });
    }

    const [removed] = room.players.splice(aiIndex, 1);
    room.log.push(`${player.name} 刪除了機器人：${removed.name}。`);

    reply?.({ ok: true });
    broadcast(room);
  });

  socket.on("game:start", (_, reply) => {
    const f=findBySocket(socket.id); if(!f) return reply?.({ok:false,error:"你不在房間中。"});
    if(!f.player.isHost) return reply?.({ok:false,error:"只有房主可開始。"});
    if(f.room.status!=="lobby") return reply?.({ok:false,error:"遊戲已開始或已結束。"});
    if(f.room.players.length<2) return reply?.({ok:false,error:"至少需要2位玩家。"});
    if(f.room.players.some(p=>!p.isAI && !p.connected)) return reply?.({ok:false,error:"有玩家目前不在線上。"});
    if(!allGuestsReady(f.room)) return reply?.({ok:false,error:"還有房客尚未準備完成。"});
    startGame(f.room); reply?.({ok:true}); broadcast(f.room); scheduleAITurn(f.room);
  });

  socket.on("game:lastStand", ({ mode = "assault" } = {}, reply) => {
    const found = findBySocket(socket.id);
    if (!found) return reply?.({ ok: false, error: "你不在房間中。" });
    const { room, player } = found;
    if (!requireTurn(room, player)) return reply?.({ ok: false, error: "還沒輪到你。" });
    const result = useLastStand(room, player, mode);
    reply?.(result);
    if (result.ok) broadcast(room);
  });

  socket.on("game:deploy", ({cardId}, reply) => {
    const f=findBySocket(socket.id); if(!f) return; const {room,player:p}=f;
    if(!requireTurn(room,p)) return reply?.({ok:false,error:"還沒輪到你。"});
    const i=p.hand.findIndex(c=>c.id===cardId); if(i<0) return reply?.({ok:false,error:"找不到手牌。"});
    if (room.tutorial && (room.tutorialProgress !== 0 || p.hand[i].name !== "中級騎兵")) return reply?.({ ok: false, error: "教學任務：請先部署中級騎兵。" });
    if(p.field.length>=5+(p.fieldBonus||0)) return reply?.({ok:false,error:"場上已滿。"});
    const [c]=p.hand.splice(i,1); c.justDeployed=true;

    let triggeredReinforcement = false;

    if(c.rank==="高級"){
      c.status.push("整備");
      c.tapped=true;
    } else {
      c.tapped = c.type==="騎兵" ? false : true;

      if (p.reinforcementAvailable && !p.reinforcementUsed) {
        c.tapped = false;
        c.status.push("急援");
        p.reinforcementUsed = true;
        triggeredReinforcement = true;
      }
    }

    p.field.push(c);
    if (room.tutorial) room.tutorialProgress = 1;
    room.log.push(`${p.name} 部署 ${c.name}${c.rank==="高級"?"，進入整備":""}${triggeredReinforcement ? "，觸發急援，本回合可以攻擊" : ""}。`);
    reply?.({ok:true}); broadcast(room);
  });

  socket.on("game:recall", ({unitId}, reply) => {
    const f=findBySocket(socket.id); if(!f) return; const {room,player:p}=f;
    if(!requireTurn(room,p)) return reply?.({ok:false,error:"還沒輪到你。"});
    const result = returnUnitToHand(room, p, unitId);
    reply?.(result);
    if (result.ok) broadcast(room);
  });

  socket.on("game:attackUnit", ({attackerId,targetPlayerId,defenderId}, reply) => {
    const found = findBySocket(socket.id);
    if (!found) return reply?.({ ok: false, error: "你不在房間中。" });
    const {room,player} = found;
    if (!requireTurn(room,player)) return reply?.({ ok: false, error: "還沒輪到你。" });
    if (room.tutorial) {
      const a = player.field.find(u => u.id === attackerId);
      const d = getPlayer(room, targetPlayerId)?.field.find(u => u.id === defenderId);
      if (room.tutorialProgress !== 2 || a?.name !== "中級騎兵" || d?.name !== "中級弓兵") return reply?.({ ok: false, error: "教學任務：請使用已強化的騎兵攻擊中級弓兵。" });
    }
    const result = resolveAttackUnit(room, player, getPlayer(room,targetPlayerId), attackerId, defenderId);
    if (room.tutorial && result.ok) room.tutorialProgress = 3;
    reply?.(result.ok ? { ok: true } : result);
    if (result.ok) broadcast(room);
  });

  socket.on("game:attackKing", ({attackerId,targetPlayerId}, reply) => {
    const found = findBySocket(socket.id);
    if (!found) return reply?.({ ok: false, error: "你不在房間中。" });
    const {room,player} = found;
    if (room.tutorial) return reply?.({ ok: false, error: "這一關先學會用魔法調整戰力，並擊敗敵方兵種。" });
    if (!requireTurn(room,player)) return reply?.({ ok: false, error: "還沒輪到你。" });
    const result = resolveAttackKing(room, player, getPlayer(room,targetPlayerId), attackerId);
    reply?.(result.ok ? { ok: true } : result);
    if (result.ok) broadcast(room);
  });

  socket.on("game:castMagic", (payload = {}, reply) => {
    const found = findBySocket(socket.id);
    if (!found) return reply?.({ ok: false, error: "你不在房間中。" });
    const { room, player } = found;
    if (!requireTurn(room, player)) return reply?.({ ok: false, error: "還沒輪到你。" });
    if (room.tutorial) {
      const m = player.magic.find(x => x.id === payload.magicId);
      const target = player.field.find(u => u.id === payload.targetUnitIds?.[0]);
      if (room.tutorialProgress !== 1 || m?.name !== "力量術" ||
          target?.name !== "中級騎兵" || payload.targetPlayerId !== player.id || payload.targetUnitIds?.length !== 1) {
        return reply?.({ ok: false, error: "教學任務：由初級法師施放力量術，指定我方中級騎兵。" });
      }
    }
    const result = resolveMagic(room, player, payload);
    if (room.tutorial && result.ok) room.tutorialProgress = 2;
    reply?.(result);
    if (result.ok) broadcast(room);
  });

  socket.on("game:endTurn", (_, reply) => {
    const f=findBySocket(socket.id); if(!f)return; const {room,player:p}=f;
    if(!requireTurn(room,p)) return reply?.({ok:false,error:"還沒輪到你。"});
    if (room.tutorial) {
      if (room.tutorialProgress !== 3) return reply?.({ ok: false, error: "請先完成部署、施法與兵種戰鬥，才能結束教學。" });
      room.tutorialProgress = 4;
      room.status = "tutorialComplete";
      room.currentPlayerId = null;
      clearTurnTimer(room);
      room.log.push("實戰教學完成：學會利用魔法改變原本無法獲勝的戰鬥結果。");
      scheduleRoomCleanup(room, 300);
      reply?.({ ok: true });
      broadcast(room);
      return;
    }
    finishTurn(room, p);
    reply?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const f = findBySocket(socket.id);
    if (!f) return;

    f.player.connected = false;
    f.room.log.push(`${f.player.name} 連線中斷。`);

    // DISCONNECT_GRACE_DISCONNECT_V1
    if (f.room.status === "playing" && !f.player.isAI && !f.player.eliminated) {
      f.room.log.push(`${f.player.name} 有 60 秒可以重新連線。`);
      scheduleDisconnectGrace(f.room, f.player, 60);
    }

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
if (process.env.KW_SIMULATION !== "1") {
  server.listen(PORT, () => console.log(`King War Online Full running on http://localhost:${PORT}`));
}


/**
 * Headless benchmark using the ACTUAL game rules, decks, king triggers and existing AI policy.
 * It measures performance under this policy, NOT unbiased king power or human win rates.
 * Simulation-only; never exposed to Socket.IO clients.
 */
export async function simulateKingBaseline({ matches = 200, playerCount = 2, maxTurns = 100, seed = 104729, difficulty = "normal", louisBonus = true, louisFreeAction = true, qinOpeningBonus = false, genghisDrawLimit = 2, genghisGuaranteedCavalry = true, genghisThreatWeight = 2, aiMagicStrategy = true, secondSeatExtraCards = 0, firstSeatPeacefulTurn = false, comebackEnabled = false, lastStandShieldEnabled = true, openingTruceEnabled = false } = {}) {
  if (process.env.KW_SIMULATION !== "1") throw new Error("This benchmark may run only with KW_SIMULATION=1");
  if (!Number.isInteger(matches) || matches < 1 || matches > 20000) throw new Error("matches out of bounds");
  if (![2,3,4,5].includes(playerCount)) throw new Error("playerCount out of bounds");
  const counts = Object.fromEntries(KINGS.map(k => [k.name, { games: 0, wins: 0, unfinished: 0 }]));
  const seats = Object.fromEntries(Array.from({ length: playerCount }, (_, n) => [n + 1, { games: 0, wins: 0 }]));
  let unfinished = 0, totalTurns = 0, comebackGames = 0, comebackWins = 0;
  const comebackUse = { assault: 0, defense: 0 }, comebackWinsByMode = { assault: 0, defense: 0 };
  const telemetry = { unitAttacks: 0, mutualKills: 0, failedTrades: 0, kingAttacks: 0,
    kingDamage: 0, damageByKing: {}, spells: {}, turnsByKing: {}, aiDeployments: 0, mongolRecalls: 0,
    comebackUses: { assault: 0, defense: 0 } };
  const turnsHistogram = { "0-9": 0, "10-19": 0, "20-39": 0, "40-79": 0, "80+": 0 };
  const violations = {};
  function checkInvariants(room) {
    const violation = name => { violations[name] = (violations[name] || 0) + 1; };
    const ids = new Set();
    const allCards = [...room.unitDeck, ...room.magicDeck,
      ...room.players.flatMap(p => [...p.hand, ...p.magic, ...p.field])];
    for (const card of allCards) {
      if (!card.id || ids.has(card.id)) violation("duplicateOrMissingCardId");
      ids.add(card.id);
    }
    for (const p of room.players) {
      if (!Number.isFinite(p.hp)) violation("nonfiniteHp");
      if (p.field.length > 5 + (p.fieldBonus || 0)) violation("overfilledField");
      if (p.hand.length > maxHand(p)) violation("oversizedHand");
      if (p.magic.length > 3) violation("oversizedMagicHand");
      if (p.hp <= 0 && !p.eliminated) violation("zeroHpNotEliminated");
    }
    if (room.status === "playing") {
      const current = room.players.find(p => p.id === room.currentPlayerId);
      if (!current || current.eliminated || current.hp <= 0) violation("invalidCurrentPlayer");
    }
  }
  const originalRandom = Math.random;
  let state = seed >>> 0 || 1;
  Math.random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  try {
    for (let n = 0; n < matches; n++) {
      // Pair variant simulations on the same independently seeded initial king/seat setup.
      state = (seed ^ Math.imul(n + 1, 0x9e3779b9)) >>> 0 || 1;
      const room = {
        code: `BALANCE_${n}`, status: "lobby", hostId: "p0", maxPlayers: playerCount,
        settings: { turnTimeLimit: 0, aiDifficulty: difficulty, louisBonus, louisFreeAction, qinOpeningBonus, genghisDrawLimit, genghisGuaranteedCavalry, genghisThreatWeight, aiMagicStrategy, secondSeatExtraCards, firstSeatPeacefulTurn, comebackEnabled, lastStandShieldEnabled, openingTruceEnabled }, log: [], unitDeck: [], magicDeck: [],
        players: Array.from({ length: playerCount }, (_, seat) => ({
          id: `p${seat}`, socketId: `SIM_${seat}`, name: `AI_${seat}`,
          isAI: true, isHost: seat === 0, connected: true, ready: true,
          hp: 30, field: [], magic: [], hand: [], eliminated: false
        }))
      };
      room.simMetrics = { unitAttacks: 0, mutualKills: 0, failedTrades: 0, kingAttacks: 0, kingDamage: 0,
        damageByKing: {}, spells: {}, turnsByKing: {}, aiDeployments: 0, mongolRecalls: 0,
        comebackUses: { assault: 0, defense: 0 } };
      rooms.set(room.code, room);
      startGame(room);
      checkInvariants(room);
      const seatIndex = Object.fromEntries(room.players.map((p, i) => [p.id, i + 1]));
      for (const p of room.players) { counts[p.king.name].games++; seats[seatIndex[p.id]].games++; }
      let turns = 0;
      while (room.status === "playing" && turns < maxTurns) {
        const before = room.currentPlayerId;
        await performAITurn(room.code);
        turns++;
        checkInvariants(room);
        if (room.currentPlayerId === before && room.status === "playing") {
          // A stalled AI action must not make this a falsely completed game.
          break;
        }
        if (room.log.length > 80) room.log.splice(0, room.log.length - 80);
      }
      totalTurns += turns;
      const bucket = turns < 10 ? "0-9" : turns < 20 ? "10-19" : turns < 40 ? "20-39" : turns < 80 ? "40-79" : "80+";
      turnsHistogram[bucket]++;
      const m = room.simMetrics;
      for (const name of ["unitAttacks","mutualKills","failedTrades","kingAttacks","kingDamage","aiDeployments","mongolRecalls"]) telemetry[name] += m[name];
      for (const name of ["damageByKing","spells","turnsByKing"]) {
        for (const [key, value] of Object.entries(m[name])) telemetry[name][key] = (telemetry[name][key] || 0) + value;
      }
      for (const mode of ["assault","defense"]) telemetry.comebackUses[mode] += m.comebackUses[mode];
      if (room.lastStandCount > 0) comebackGames++;
      for (const [mode, count] of Object.entries(room.lastStandModes || {})) comebackUse[mode] += count;
      const survivors = alive(room);
      if (room.status === "ended" && survivors.length === 1) {
        const winner = survivors[0];
        counts[winner.king.name].wins++;
        seats[seatIndex[winner.id]].wins++;
        if (winner.lastStandUsed) {
          comebackWins++;
          if (winner.lastStandMode in comebackWinsByMode) comebackWinsByMode[winner.lastStandMode]++;
        }
      } else {
        unfinished++;
        for (const p of room.players) counts[p.king.name].unfinished++;
      }
      rooms.delete(room.code);
    }
  } finally {
    Math.random = originalRandom;
    rooms.clear();
  }
  return {
    methodology: "actual server rules and chosen AI policy; randomly assigned kings/seats; unfinished games count as no win",
    seed, matches, playerCount, maxTurns, difficulty, louisBonus, louisFreeAction, qinOpeningBonus, genghisDrawLimit, genghisGuaranteedCavalry, comebackEnabled, lastStandShieldEnabled, openingTruceEnabled,
    finished: matches - unfinished, unfinished, averageTurns: +(totalTurns / matches).toFixed(1),
    comebackGames, comebackWins, comebackUse, comebackWinsByMode, telemetry, turnsHistogram, invariantViolations: violations,
    kings: Object.fromEntries(Object.entries(counts).map(([name, count]) =>
      [name, { ...count, winRate: count.games ? +(100 * count.wins / count.games).toFixed(2) : 0 }])),
    seats: Object.fromEntries(Object.entries(seats).map(([seat, count]) =>
      [seat, { ...count, winRate: count.games ? +(100 * count.wins / count.games).toFixed(2) : 0 }]))
  };
}
