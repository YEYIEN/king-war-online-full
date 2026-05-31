
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
const turnTimers = new Map();
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
const MAGIC_LEVEL_RANK = { 初級魔法: "初級", 中級魔法: "中級", 高級魔法: "高級" };

const KINGS = [
  { name: "亞歷山大大帝", effectName: "征服遠征", effect: "戰鬥消滅敵方兵種後抽1張兵種卡。" },
  { name: "屋大維奧古斯都", effectName: "羅馬秩序", effect: "非自己回合時，隨機1名我方場上兵種戰力+1。" },
  { name: "成吉思汗", effectName: "草原機動", effect: "每回合可撤回1名我方兵種；若是騎兵，抽1張兵種卡。" },
  { name: "秦始皇", effectName: "中央集權", effect: "手牌上限9，每回合開始抽2張兵種卡。" },
  { name: "路易十四", effectName: "太陽王權", effect: "每回合第一次使用魔法卡後，抽1張兵種卡。" }
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

function finishIfGameOver(room) {
  if (!room || room.status === "ended") return true;

  const living = alive(room);

  if (living.length <= 1) {
    clearTurnTimer(room);
    room.status = "ended";
    room.currentPlayerId = null;
    room.log.push(`${living[0]?.name || "無人"} 獲勝！`);
    return true;
  }

  return false;
}
function nextAlive(room, id) { const a=alive(room); const i=a.findIndex(p=>p.id===id); return a[(i+1)%a.length] || a[0]; }
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
  p.fieldBonus = 0;
  p.field.forEach(u => {
    u.tapped = false; u.justDeployed = false; u.archerBonusUsed = false;
    u.status = u.status.filter(s => !["階級+1","階級-1","整備","傷害+1","燃血+1傷害","急援"].includes(s));
  });
  const ud = p.king?.name === "秦始皇" ? 2 : 1;
  drawUnits(room, p, ud);
  const mages = p.field.filter(u => u.type === "法師").length;
  const md = drawMagic(room, p, mages);
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
function freeze(u) { if (!u.status.includes("不能攻擊")) u.status.push("不能攻擊"); }
function fireball(owner, id) { const i=owner.field.findIndex(u=>u.id===id); if(i<0)return; const u=owner.field[i]; if(u.rank==="初級") owner.field.splice(i,1); else u.status.push("階級-1"); }

function publicPlayer(p, viewer) {
  const isMe = p.id === viewer;
  return { id:p.id, name:p.name, isHost:p.isHost, connected:p.connected, hp:p.hp, king:p.king, field:p.field, hand:isMe?p.hand:[], magic:isMe?p.magic:[], handCount:p.hand.length, magicCount:p.magic.length, eliminated:p.eliminated, isAI: !!p.isAI, ready: !!p.ready, reinforcementAvailable: !!p.reinforcementAvailable, reinforcementUsed: !!p.reinforcementUsed };
}
function viewFor(room, viewer) { return { roomCode:room.code, hostId:room.hostId, maxPlayers:room.maxPlayers, settings: room.settings || { turnTimeLimit: 0 }, status:room.status, isPublic: !!room.isPublic, roomType: room.tutorial ? "操作教學" : room.isPublic ? "公開房間" : "私人房間",
    tutorial: !!room.tutorial, currentPlayerId:room.currentPlayerId, turnStartedAt: room.turnStartedAt || null, log:room.log.slice(-50), players:room.players.map(p=>publicPlayer(p, viewer)) }; }
function broadcast(room) { room.players.forEach(p => { if (!isAIPlayer(p)) io.to(p.socketId).emit("room:update", viewFor(room,p.id)); }); }
function findBySocket(sid) { for (const room of rooms.values()) { const p=room.players.find(x=>x.socketId===sid); if(p) return {room, player:p}; } return null; }
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

function finishTimedOutTurn(room, player) {
  if (!room || !player) return;
  if (room.status !== "playing") return;
  if (room.currentPlayerId !== player.id) return;
  if (player.eliminated) return;

  clearTurnTimer(room);

  clearEndOfTurnBuffs(player);

  if (typeof clearEndTurnControl === "function") {
    clearEndTurnControl(player);
  }

  if (typeof advanceFatigue === "function") {
    advanceFatigue(player);
  }

  player.field = player.field.filter((u) => !u.status.includes("下回合死亡"));

  trimHand(room, player);
  applyOct(room, player);

  if (finishIfGameOver(room)) {
    broadcast(room);
    return;
  }

  const next = nextAlive(room, player.id);
  room.currentPlayerId = next.id;
  room.log.push(`${player.name} 時間到，系統自動結束回合。`);

  startTurn(room, next);
  broadcast(room);
  scheduleAITurn(room);
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

function forcePlayerDefeat(room, player, reason = "離開遊戲，視同投降。") {
  if (!room || !player || room.status !== "playing" || player.eliminated) return false;

  player.hp = 0;
  player.eliminated = true;
  player.connected = false;
  player.socketId = null;
  room.log.push(`${player.name} ${reason}`);

  if (finishIfGameOver(room)) {
    broadcast(room);
    return true;
  }

  if (room.currentPlayerId === player.id) {
    const next = nextAlive(room, player.id);
    if (next) {
      room.currentPlayerId = next.id;
      room.log.push(`輪到 ${next.name} 行動。`);
      startTurn(room, next);
      broadcast(room);
      scheduleAITurn(room);
    }
  } else {
    broadcast(room);
  }

  return true;
}

function startGame(room) {
  room.status = "playing";
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
    p.fieldBonus = 0;

    drawUnits(room, p, p.king.name === "秦始皇" ? 6 : 5);
  });

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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scheduleAITurn(room) {
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
  let deployLimit = ai.field.length === 0 ? 2 : ai.field.length <= 2 ? 2 : 1;

  while (deployLimit > 0 && ai.hand.length > 0 && ai.field.length < 5) {
    const scored = ai.hand
      .map((card, index) => ({ card, index, score: aiDeployScore(card, ai, enemy) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
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

function aiResolveAttackUnit(room, ai, enemy, attackerId, defenderId) {
  const aiIdx = ai.field.findIndex((u) => u.id === attackerId);
  const enemyIdx = enemy.field.findIndex((u) => u.id === defenderId);
  if (aiIdx < 0 || enemyIdx < 0) return false;

  const attacker = ai.field[aiIdx];
  const defender = enemy.field[enemyIdx];
  if (!aiCanAttack(attacker)) return false;

  const aPower = power(attacker);
  const dPower = power(defender);
  const result = aiBattleResult(attacker, defender);

  attacker.tapped = true;

  let killedEnemy = false;
  let archerSaved = false;
  let archerExtra = false;

  if (attacker.type === "弓兵") {
    if (dPower < aPower && !attacker.archerBonusUsed) archerExtra = true;
    if (dPower >= aPower) {
      archerSaved = true;
      if (dPower > aPower && !attacker.status.includes("疲乏")) attacker.status.push("疲乏");
    }
  }

  if (result === "attacker") {
    enemy.field.splice(enemyIdx, 1);
    killedEnemy = true;
  } else if (result === "defender") {
    if (!archerSaved) ai.field.splice(aiIdx, 1);
  } else {
    enemy.field.splice(enemyIdx, 1);
    killedEnemy = true;
    if (!archerSaved) ai.field.splice(aiIdx, 1);
  }

  const survivingAttacker = ai.field.find((u) => u.id === attacker.id);
  if (survivingAttacker && archerExtra) {
    survivingAttacker.tapped = false;
    survivingAttacker.archerBonusUsed = true;
    room.log.push(`${survivingAttacker.name} 觸發弓兵額外攻擊。`);
  }

  if (killedEnemy && ai.king?.name === "亞歷山大大帝") {
    drawUnits(room, ai, 1);
    room.log.push(`${ai.name} 的亞歷山大效果：抽1張兵種卡。`);
  }

  room.log.push(`${ai.name} 用 ${attacker.name} 攻擊 ${enemy.name} 的 ${defender.name}。`);
  return true;
}

function aiResolveAttackKing(room, ai, enemy, attackerId) {
  const attacker = ai.field.find((u) => u.id === attackerId);
  if (!attacker || !aiCanAttack(attacker)) return false;
  if (enemy.field.some((u) => u.type === "步兵")) return false;

  const dmg = effectiveDamage(attacker);
  enemy.hp -= dmg;
  attacker.tapped = true;

  room.log.push(`${ai.name} 用 ${attacker.name} 攻擊 ${enemy.name} 國王，造成${dmg}傷害。`);

  if (enemy.hp <= 0) {
    enemy.eliminated = true;
    room.log.push(`${enemy.name} 出局。`);
    finishIfGameOver(room);
  }

  return true;
}

async function aiAttackPhase(room, ai, enemy) {
  let safety = 0;

  while (safety < 8) {
    safety++;

    const attackers = ai.field.filter((u) => aiCanAttack(u));
    if (!attackers.length) break;

    const actions = [];

    for (const attacker of attackers) {
      if (!enemy.field.some((u) => u.type === "步兵")) {
        actions.push({
          type: "king",
          attackerId: attacker.id,
          score: aiAttackScore(attacker, enemy, null)
        });
      }

      for (const defender of enemy.field) {
        actions.push({
          type: "unit",
          attackerId: attacker.id,
          defenderId: defender.id,
          score: aiAttackScore(attacker, enemy, defender)
        });
      }
    }

    actions.sort((a, b) => b.score - a.score);
    const best = actions[0];

    if (!best || best.score < 5) break;

    if (best.type === "king") {
      aiResolveAttackKing(room, ai, enemy, best.attackerId);
    } else {
      aiResolveAttackUnit(room, ai, enemy, best.attackerId, best.defenderId);
    }

    broadcast(room);
    await sleep(1900);

    if (enemy.eliminated) break;
  }
}

function aiChooseMagic(room, ai, enemy) {
  const mages = ai.field.filter((u) => u.type === "法師" && !u.tapped && !u.status.includes("不能攻擊"));
  if (!mages.length || !ai.magic.length) return false;

  for (const magic of [...ai.magic]) {
    const caster = mages.find((m) => mageCanCast(m, magic));
    if (!caster) continue;

    if (magic.name === "天殞術") {
      const lowRankTargets = enemy.field.filter((u) => u.rank !== "高級");
      if (lowRankTargets.length >= 2 || enemy.field.length >= 4) {
        const idx = ai.magic.findIndex((m) => m.id === magic.id);
        ai.magic.splice(idx, 1);
        caster.tapped = true;
        room.magicDeck.push(magic);

        const before = enemy.field.length;
        enemy.field = enemy.field.filter((unit) => {
          if (unit.rank !== "高級") return false;
          freeze(unit);
          return true;
        });

        room.log.push(`${ai.name} 用 ${caster.name} 施放天殞術，消滅 ${before - enemy.field.length} 名低於高級的兵種。`);
        return true;
      }
    }

    if (["火球術", "流星雨", "冰凍術", "虛弱術", "毒藥瓶"].includes(magic.name)) {
      let targets = [...enemy.field];

      if (magic.name === "火球術" || magic.name === "流星雨") {
        targets.sort((a, b) => {
          const aScore = (a.type === "步兵" ? 20 : 0) + aiRankValue(a.rank) * 8;
          const bScore = (b.type === "步兵" ? 20 : 0) + aiRankValue(b.rank) * 8;
          return bScore - aScore;
        });
      } else if (magic.name === "冰凍術" || magic.name === "虛弱術" || magic.name === "毒藥瓶") {
        targets.sort((a, b) => aiRankValue(b.rank) - aiRankValue(a.rank));
      }

      targets = targets.slice(0, magic.maxTargets || 1);
      if (!targets.length) continue;

      const idx = ai.magic.findIndex((m) => m.id === magic.id);
      ai.magic.splice(idx, 1);
      caster.tapped = true;
      room.magicDeck.push(magic);

      for (const target of targets) {
        const id = target.id;
        if (magic.name === "火球術") fireball(enemy, id);
        if (magic.name === "流星雨") fireball(enemy, id);
        if (magic.name === "冰凍術") { if(target.rank === "高級") target.status.push("階級-1"); else freeze(target); }
        if (magic.name === "虛弱術") {
          target.status.push("階級-1");
          if (target.rank === "初級") freeze(target);
        }
        if (magic.name === "毒藥瓶") target.status.push("下回合死亡");
      }

      const usedCaster = ai.field.find((u) => u.id === caster.id);
      if (usedCaster) usedCaster.tapped = true;

      room.log.push(`${ai.name} 用 ${caster.name} 施放 ${magic.name}。`);
      return true;
    }

    if (["力量術", "增強術", "燃血術"].includes(magic.name)) {
      const candidates = ai.field
        .filter((u) => !u.status.includes("整備"))
        .sort((a, b) => aiRankValue(b.rank) - aiRankValue(a.rank));

      const target = candidates[0];
      if (!target) continue;
      if (magic.name === "燃血術" && ai.hp <= 10) continue;

      const idx = ai.magic.findIndex((m) => m.id === magic.id);
      ai.magic.splice(idx, 1);
      caster.tapped = true;
      room.magicDeck.push(magic);

      if (magic.name === "燃血術") {
        ai.hp -= 3;
        if (ai.hp <= 0) {
          ai.eliminated = true;
          room.log.push(`${ai.name} 因燃血術失去過多 HP，出局。`);
          finishIfGameOver(room);
          return true;
        }
      }
      if (magic.name === "力量術") {
        target.status.push("力量術+1");
      }

      if (magic.name === "增強術") {
        target.status.push("階級+1");
        if (!target.tapped) target.status.push("傷害+1");
      }

      if (magic.name === "燃血術") {
        target.status.push("階級+1");
        target.status.push("燃血+1傷害");
        target.tapped = false;
      }

      const usedCaster = ai.field.find((u) => u.id === caster.id);
      if (usedCaster) usedCaster.tapped = true;

      room.log.push(`${ai.name} 用 ${caster.name} 施放 ${magic.name} 強化 ${target.name}。`);
      return true;
    }
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
  clearEndOfTurnBuffs(ai);
  clearEndTurnControl(ai);
  advanceFatigue(ai);
  ai.field = ai.field.filter((u) => !u.status.includes("下回合死亡"));
  trimHand(room, ai);
  applyOct(room, ai);

  const living = alive(room);
  if (living.length <= 1) {
    room.status = "ended";
    room.log.push(`${living[0]?.name || "無人"} 獲勝！`);
    broadcast(room);
    return;
  }

  const next = nextAlive(room, ai.id);
  room.currentPlayerId = next.id;
  room.log.push(`${ai.name} 結束回合。`);
  startTurn(room, next);
  broadcast(room);
  scheduleAITurn(room);
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

  const enemies = room.players.filter((p) => p.id !== ai.id && !p.eliminated);
  const enemy = enemies[0];

  if (!enemy) {
    room.status = "ended";
    room.log.push(`${ai.name} 獲勝！`);
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

  const beforeDeployCount = ai.field.length;
  aiDeployUnits(room, ai, enemy);
  if (ai.field.length !== beforeDeployCount) {
    broadcast(room);
    await sleep(2100);
    if (!isStillAITurn(room, ai)) return;
  }

  if (!isStillAITurn(room, ai)) return;

  const usedMagic = aiChooseMagic(room, ai, enemy);
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

  room.log.push(`${ai.name} 準備結束回合。`);
  broadcast(room);
  await sleep(1600);
  if (!isStillAITurn(room, ai)) return;

  aiEndTurn(room, ai);
}


io.on("connection", socket => {


  socket.on("room:resume", ({ roomCode, playerId }, reply) => {
    const codeText = String(roomCode || "").trim().toUpperCase();
    const pid = String(playerId || "");

    const room = rooms.get(codeText);
    if (!room) return reply?.({ ok: false, error: "找不到原本房間。" });

    const player = room.players.find((p) => p.id === pid);
    if (!player) return reply?.({ ok: false, error: "找不到原本玩家。" });

    player.socketId = socket.id;
    player.connected = true;
    socket.join(room.code);

    // DISCONNECT_GRACE_RESUME_V1
    clearDisconnectGrace(room, player);

    room.log.push(`${player.name} 已重新連線。`);

    reply?.({ ok: true, playerId: player.id, room: viewFor(room, player.id) });
    broadcast(room);
  });


  socket.on("room:leave", (_, reply) => {
    const f = findBySocket(socket.id);
    if (!f) return reply?.({ ok: true });

    const { room, player } = f;

    // DISCONNECT_GRACE_LEAVE_V1
    clearDisconnectGrace(room, player);

    if (room.status === "playing") {
      forcePlayerDefeat(room, player, "回到主選單，視同投降.");
    } else {
      player.connected = false;
      player.socketId = null;
      socket.leave(room.code);
      room.log.push(`${player.name} 離開房間。`);
      broadcast(room);
    }

    reply?.({ ok: true });
  });

  socket.on("singleplayer:start", ({ name }, reply) => {
    const roomCode = code();
    const humanId = nanoid(10);
    const aiId = nanoid(10);

    const human = {
      id: humanId,
      socketId: socket.id,
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
      players: [human, ai],
      unitDeck: [],
      magicDeck: [],
      currentPlayerId: null,
      log: [`${human.name} 開始單人模式，AI 對手：訓練騎士。`]
    };

    rooms.set(roomCode, room);
    socket.join(roomCode);

    startGame(room);

    reply?.({ ok: true, playerId: humanId, room: viewFor(room, humanId) });
    broadcast(room);
    scheduleAITurn(room);
  });




  socket.on("tutorial:start", ({ name }, reply) => {
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
      field: [takeCard(unitDeck, "初級弓兵")],
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
      matchmaking: false,
      singleplayer: false,
      settings: { turnTimeLimit: 0 },
      players: [player, ai],
      unitDeck,
      magicDeck,
      currentPlayerId: pid,
      turnStartedAt: Date.now(),
      log: [
        "操作教學開始：這是一個固定教學房，請照正式對戰畫面完成部署、攻擊、施法與結束回合。",
        "教學提示：先部署手牌中的初級騎兵。"
      ]
    };

    rooms.set(roomCode, room);
    socket.join(roomCode);

    reply?.({
      ok: true,
      playerId: pid,
      room: viewFor(room, pid)
    });

    broadcast(room);
  });

  socket.on("matchmaking:join", ({ name }, reply) => {
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
        settings: { turnTimeLimit: 0 },
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
        room: viewFor(room, pid),
        waiting: true
      });

      broadcast(room);
      return;
    }

    const player = {
      id: pid,
      socketId: socket.id,
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
      room: viewFor(room, pid),
      waiting: false
    });

    broadcast(room);
  });

  socket.on("room:create", ({ name, maxPlayers }, reply) => {
    const roomCode = code();
    const pid = nanoid(10);

    const player = {
      id: pid,
      socketId: socket.id,
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
      settings: { turnTimeLimit: 0 },
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
      room: viewFor(room, pid)
    });
  });

  socket.on("room:join", ({name,code:roomCode}, reply) => {
    const room=rooms.get(String(roomCode||"").trim().toUpperCase());
    if(!room) return reply?.({ok:false,error:"找不到房間。"});
    if(room.status!=="lobby") return reply?.({ok:false,error:"遊戲已開始。"});
    if(room.players.length>=room.maxPlayers) return reply?.({ok:false,error:"房間已滿。"});
    const pid=nanoid(10), p={id:pid,socketId:socket.id,name:cleanDisplayName(name),isHost:false,connected:true,ready:false,hp:30,king:null,hand:[],magic:[],field:[],eliminated:false};
    room.players.push(p); room.log.push(`${p.name} 加入房間。`); socket.join(room.code); reply?.({ok:true,playerId:pid,room:viewFor(room,pid)}); broadcast(room);
  });


  socket.on("game:rematch", (_, reply) => {
    const f = findBySocket(socket.id);
    if (!f) return reply?.({ ok: false, error: "你不在房間中。" });

    const { room, player } = f;

    if (room.status !== "ended") {
      return reply?.({ ok: false, error: "目前遊戲尚未結束。" });
    }

    if (typeof clearTurnTimer === "function") {
      clearTurnTimer(room);
    }

    // 保留原房間；只移除已斷線真人，AI 保留。
    room.players = room.players.filter((p) => p.connected || p.isAI);

    if (room.players.length < 2) {
      return reply?.({ ok: false, error: "房間內玩家不足，無法再來一局。" });
    }

    // 確保按下按鈕的玩家仍在線
    const livePlayer = room.players.find((p) => p.id === player.id);
    if (livePlayer) {
      livePlayer.socketId = socket.id;
      livePlayer.connected = true;
    }

    // 確保房主存在
    const hostStillHere = room.players.some((p) => p.id === room.hostId);
    if (!hostStillHere) {
      const newHost = room.players.find((p) => !p.isAI) || room.players[0];
      room.hostId = newHost.id;
    }

    room.players.forEach((p) => {
      p.isHost = p.id === room.hostId;
      p.ready = true;
      p.eliminated = false;
      p.hp = 30;
      p.field = [];
      p.hand = [];
      p.magic = [];
      p.magicDrawUsed = false;
      p.recallUsed = false;
      p.fieldBonus = 0;
      p.reinforcementAvailable = false;
      p.reinforcementUsed = false;
    });

    room.log = [`${player.name} 選擇再來一局，原房間重新開始。`];

    startGame(room);

    const viewerId = livePlayer?.id || player.id;

    reply?.({
      ok: true,
      playerId: viewerId,
      room: viewFor(room, viewerId)
    });

    broadcast(room);
    scheduleAITurn(room);
  });


  socket.on("room:updateSettings", ({ maxPlayers, turnTimeLimit }, reply) => {
    const f = findBySocket(socket.id);
    if (!f) return reply?.({ ok: false, error: "你不在房間中。" });

    const { room, player } = f;

    if (room.status !== "lobby") {
      return reply?.({ ok: false, error: "遊戲開始後不能調整房間設定。" });
    }

    if (player.id !== room.hostId) {
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

  socket.on("room:toggleReady", (_, reply) => {
    const f = findBySocket(socket.id);
    if (!f) return reply?.({ ok: false, error: "你不在房間中。" });

    const { room, player } = f;

    if (room.status !== "lobby") {
      return reply?.({ ok: false, error: "遊戲已開始，不能切換準備狀態。" });
    }

    if (player.isHost) {
      return reply?.({ ok: false, error: "房主不需要準備。" });
    }

    player.ready = !player.ready;

    room.log.push(`${player.name} ${player.ready ? "準備完成" : "取消準備"}。`);

    reply?.({ ok: true });
    broadcast(room);
  });

  socket.on("game:start", (_, reply) => {
    const f=findBySocket(socket.id); if(!f) return reply?.({ok:false,error:"你不在房間中。"});
    if(!f.player.isHost) return reply?.({ok:false,error:"只有房主可開始。"});
    if(f.room.players.length<2) return reply?.({ok:false,error:"至少需要2位玩家。"});
    if(!allGuestsReady(f.room)) return reply?.({ok:false,error:"還有房客尚未準備完成。"});
    startGame(f.room); reply?.({ok:true}); broadcast(f.room); scheduleAITurn(f.room);
  });

  socket.on("game:deploy", ({cardId}, reply) => {
    const f=findBySocket(socket.id); if(!f) return; const {room,player:p}=f;
    if(!requireTurn(room,p)) return reply?.({ok:false,error:"還沒輪到你。"});
    const i=p.hand.findIndex(c=>c.id===cardId); if(i<0) return reply?.({ok:false,error:"找不到手牌。"});
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
    room.log.push(`${p.name} 部署 ${c.name}${c.rank==="高級"?"，進入整備":""}${triggeredReinforcement ? "，觸發急援，本回合可以攻擊" : ""}。`);
    reply?.({ok:true}); broadcast(room);
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
    if(a.type==="弓兵"){ if(dp<ap && !a.archerBonusUsed) archerExtra=true; if(dp>=ap){archerSaved=true; if(dp>ap && !a.status.includes("疲乏")) a.status.push("疲乏");}}
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
    const dmg = effectiveDamage(a); target.hp-=dmg; a.tapped=true; if(target.hp<=0){target.eliminated=true; room.log.push(`${target.name} 出局。`);}
    room.log.push(`${p.name} 用 ${a.name} 攻擊 ${target.name} 國王，造成${dmg}傷害。`); if (finishIfGameOver(room)) { reply?.({ok:true}); broadcast(room); return; } reply?.({ok:true}); broadcast(room);
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
    // MAGIC_TARGET_EXISTENCE_CHECK_V2
    // 消耗魔法卡前，先確認指定目標仍存在，避免「卡被吃掉但沒有生效」。
    if (magic.name !== "天殞術") {
      const missingIds = ids.filter((id) => !target.field.some((u) => u.id === id));

      if (missingIds.length > 0) {
        return reply?.({
          ok: false,
          error: "指定的魔法目標已不存在，請重新選擇目標。"
        });
      }
    }

    p.magic.splice(mi,1); caster.tapped=true; room.magicDeck.push(magic);
    if(magic.name==="天殞術"){
      const before=target.field.length; target.field=target.field.filter(u=>{ if(u.rank!=="高級") return false; freeze(u); return true; });
      room.log.push(`${p.name} 施放天殞術：${target.name} 低於高級死亡${before-target.field.length}名，高級暫停。`);
    } else {
      ids.forEach(id=>{
        const i=target.field.findIndex(u=>u.id===id); if(i<0)return; const u=target.field[i];
        if(magic.name==="火球術") fireball(target,id);
        if(magic.name==="冰凍術"){ if(u.rank==="高級") u.status.push("階級-1"); else freeze(u); }
        if(magic.name==="力量術"){u.status.push("力量術+1");}
        if(magic.name==="虛弱術"){u.status.push("階級-1"); if(u.rank==="初級") freeze(u);}
        if(magic.name==="增強術"){u.status.push("階級+1"); if(!u.tapped) u.status.push("傷害+1");}
        if(magic.name==="毒藥瓶") u.status.push("下回合死亡");
        if(magic.name==="燃血術"){
          p.hp-=3;
          if(p.hp<=0){
            p.eliminated=true;
            room.log.push(`${p.name} 因燃血術失去過多 HP，出局。`);
            finishIfGameOver(room);
          }
          u.status.push("階級+1");
          u.status.push("燃血+1傷害");
          u.tapped=false;
        }
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
    clearEndOfTurnBuffs(p); clearEndTurnControl(p); advanceFatigue(p); p.field=p.field.filter(u=>!u.status.includes("下回合死亡")); trimHand(room,p); applyOct(room,p);
    const a=alive(room); if(a.length<=1){room.status="ended"; room.log.push(`${a[0]?.name||"無人"} 獲勝！`); reply?.({ok:true}); broadcast(room); return;}
    const n=nextAlive(room,p.id); room.currentPlayerId=n.id; room.log.push(`${p.name} 結束回合。`); startTurn(room,n); reply?.({ok:true}); broadcast(room); scheduleAITurn(room);
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
server.listen(PORT, () => console.log(`King War Online Full running on http://localhost:${PORT}`));
