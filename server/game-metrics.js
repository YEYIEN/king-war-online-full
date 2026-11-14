import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * Privacy-minimized match telemetry. NEVER persist player IDs, names, room codes,
 * addresses, socket IDs, hand contents, event logs or reconnect tokens.
 * Records are emitted once after a real completed match.
 */
export const METRICS_SCHEMA_VERSION = 1;
const NONNEGATIVE = new Set(["deploy","unitAttack","unitKill","unitTrade","kingAttack","kingDamage","spellCast","spellImpact","recall","lastStand"]);
const ALLOWED_MODES = new Set(["assault","defense"]);

export function createMatchMetrics(room, now = Date.now()) {
  return {
    startedAt: now,
    events: Object.fromEntries([...NONNEGATIVE].map(k => [k,0])),
    spells: {}, spellsEffective: {},
    playerEvents: {}, turnDurationsMs: [],
    turnsStarted: 0,
    turnsCompleted: 0,
    finishReason: null
  };
}

export function incrementMatchMetric(room, event, amount = 1, extra = {}) {
  const m = room?.matchMetrics;
  if (!m || !NONNEGATIVE.has(event) || !Number.isFinite(amount) || amount < 0) return;
  m.events[event] += amount;
  if (extra.playerId && room.players?.some(p=>p.id===extra.playerId)) {
    m.playerEvents[extra.playerId] ??= {};
    m.playerEvents[extra.playerId][event] = (m.playerEvents[extra.playerId][event] || 0) + amount;
  }
  if (event === "spellCast" && typeof extra.spell === "string" && extra.spell.length <= 12) {
    m.spells[extra.spell] = (m.spells[extra.spell] || 0) + 1;
    if (extra.effective) m.spellsEffective[extra.spell] = (m.spellsEffective[extra.spell] || 0) + 1;
  }
}

export function recordTurnDuration(room, ms) {
  const m = room?.matchMetrics;
  if (!m || !Number.isFinite(ms) || ms < 0) return;
  m.turnsCompleted++;
  m.turnDurationsMs.push(Math.min(ms, 3600000));
}
function aggregateDuration(values) {
  if (!values.length) return { meanMs: null, medianMs: null, p90Ms: null, samples: 0 };
  const s=[...values].sort((a,b)=>a-b);
  const q=ratio=>s[Math.min(s.length-1,Math.floor((s.length-1)*ratio))];
  return { meanMs: Math.round(values.reduce((a,b)=>a+b,0)/values.length),
    medianMs:q(.5),p90Ms:q(.9),samples:values.length };
}
export function buildMatchSummary(room, { winnerId = null, reason = "last-standing", now = Date.now(), comeback = null } = {}) {
  const m=room?.matchMetrics;
  if (!m) return null;
  const winners=room.players.filter(p=>p.id===winnerId);
  const mode=room.tutorial ? "tutorial" : room.singleplayer ? "singleplayer" :
    room.matchmaking ? "matchmaking" : "multiplayer";
  const aiCount=room.players.filter(p=>p.isAI).length;
  return {
    schemaVersion:METRICS_SCHEMA_VERSION, source:"live", mode,
    rulesetId:String(process.env.KW_RULESET_ID || "unversioned").slice(0,80),
    finishedAt:new Date(now).toISOString(),
    elapsedMs:Math.max(0,now-m.startedAt),
    playerCount:room.players.length,aiCount,humanCount:room.players.length-aiCount,
    aiDifficulty:room.settings?.aiDifficulty || "normal",
    turnsCompleted:room.turnsCompleted || 0,
    turnDuration:aggregateDuration(m.turnDurationsMs),
    finishReason:reason,
    winnerSeat:winners.length ? room.players.indexOf(winners[0])+1 : null,
    winnerKing:winners[0]?.king?.name ?? null,
    comeback:comeback ? {severeQualified:comeback.trailingPlayers>0,criticalQualified:comeback.criticalPlayers>0,
      severe:!!comeback.comebackWin,critical:!!comeback.criticalWin} : null,
    events:{...m.events},spells:{...m.spells},spellsEffective:{...m.spellsEffective},
    seats:room.players.map((p,i)=>({
      seat:i+1,king:p.king?.name || "unknown",ai:!!p.isAI,
      aiDifficulty:p.isAI ? (p.aiDifficulty || room.settings?.aiDifficulty || "normal") : null,
      won:p.id===winnerId,eliminated:!!p.eliminated,finalHp:Math.max(0,p.hp || 0),
      actions:{...(m.playerEvents[p.id]||{})}
    }))
  };
}
let writeQueue=Promise.resolve();
export function persistMatchSummary(summary,{ filePath=process.env.KW_MATCH_METRICS_FILE,
  simulation=process.env.KW_SIMULATION === "1" }={}) {
  if(!summary||simulation||!filePath) return Promise.resolve(false);
  // Explicit filesystem destination only; deployers must mount persistent storage if needed.
  const target=resolve(filePath);
  const row=JSON.stringify(summary)+"\n";
  const write=async()=>{await mkdir(dirname(target),{recursive:true});await appendFile(target,row,{encoding:"utf8",mode:0o600});return true;};
  const pending=writeQueue.then(write,write);
  writeQueue=pending.catch(error=>console.error("Match metrics write failed:",error.message));
  return pending;
}
export function finalizeMatchMetrics(room,{winnerId=null,reason="last-standing",now=Date.now(),comeback=null,
  persist=persistMatchSummary}={}) {
  if(!room?.matchMetrics || room.matchMetrics.finalized) return null;
  room.matchMetrics.finalized=true;
  const summary=buildMatchSummary(room,{winnerId,reason,now,comeback});
  void persist(summary).catch(error=>console.error("Match metrics persistence failed:",error.message));
  return summary;
}
