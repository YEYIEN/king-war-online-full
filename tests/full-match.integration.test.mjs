import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { test } from "node:test";

const requireClient = createRequire(new URL("../client/package.json", import.meta.url));
const { io } = requireClient("socket.io-client");

async function getPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function emit(socket, event, body = {}) {
  return new Promise((resolve, reject) =>
    socket.timeout(4000).emit(event, body, (err, reply) => err ? reject(err) : resolve(reply)));
}

async function connect(port) {
  const socket = io(`http://127.0.0.1:${port}`, {
    transports: ["websocket"], reconnection: false, timeout: 2000
  });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}

test("full two-human match reaches winner, blocks invalid actions, and consumes an action", { timeout: 45000 }, async () => {
  const port = await getPort();
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, PORT: String(port), NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const sockets = [];
  const latest = new Map();
  let errors = "";
  child.stderr.on("data", chunk => { errors += chunk; });
  async function register() {
    const s = await connect(port);
    sockets.push(s);
    s.on("room:update", next => latest.set(s, next));
    return s;
  }
  try {
    let host;
    for (let i = 0; i < 40; i++) {
      try { host = await register(); break; }
      catch { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(host, `Server start failed: ${errors}`);
    const initial = await emit(host, "room:create", { name: "P1", maxPlayers: 2 });
    assert.equal(initial.ok, true);
    const guest = await register();
    const joined = await emit(guest, "room:join", { name: "P2", code: initial.room.roomCode });
    assert.equal(joined.ok, true);
    await emit(guest, "room:toggleReady");
    assert.equal((await emit(host, "game:start")).ok, true);

    const players = new Map([[initial.playerId, host], [joined.playerId, guest]]);
    const firstState = (await emit(host, "room:resume", {
      roomCode: initial.room.roomCode, playerId: initial.playerId
    })).room;
    const attackerId = firstState.currentPlayerId;
    const opponentId = [...players.keys()].find(id => id !== attackerId);
    const attackerSocket = players.get(attackerId);
    let attacks = 0, reachedEnd = false;

    for (let round = 0; round < 85; round++) {
      const last = latest.get(attackerSocket);
      if (last?.status === "ended") { reachedEnd = true; break; }
      const stateReply = await emit(attackerSocket, "room:resume", {
        roomCode: initial.room.roomCode, playerId: attackerId
      });
      if (!stateReply.ok) {
        reachedEnd = latest.get(attackerSocket)?.status === "ended";
        break;
      }
      const state = stateReply.room;
      if (state.currentPlayerId !== attackerId) {
        const opponentSocket = players.get(opponentId);
        const next = await emit(opponentSocket, "game:endTurn");
        assert.equal(next.ok, true, "opponent should pass its turn");
        continue;
      }
      let me = state.players.find(p => p.id === attackerId);
      let enemy = state.players.find(p => p.id === opponentId);
      assert.equal(enemy.field.length, 0, "passive defender should have no infantry guard");
      for (const card of [...me.hand]) {
        if (me.field.length >= 5) break;
        const deployed = await emit(attackerSocket, "game:deploy", { cardId: card.id });
        assert.equal(deployed.ok, true);
        me.field.push(card);
      }
      // Request the authoritative field after deployment.
      const afterDeploy = (await emit(attackerSocket, "room:resume", {
        roomCode: initial.room.roomCode, playerId: attackerId
      })).room;
      me = afterDeploy.players.find(p => p.id === attackerId);
      for (const unit of me.field) {
        if (unit.tapped || (unit.status || []).some(s => ["整備","不能攻擊","疲乏","疲乏待解"].includes(s))) continue;
        const hit = await emit(attackerSocket, "game:attackKing", {
          attackerId: unit.id, targetPlayerId: opponentId
        });
        assert.equal(hit.ok, true);
        attacks++;
        if (latest.get(attackerSocket)?.status === "ended") break;
      }
      if (latest.get(attackerSocket)?.status === "ended") { reachedEnd = true; break; }
      assert.equal((await emit(attackerSocket, "game:endTurn")).ok, true);
    }
    // Broadcast follows the acknowledgement for attacks; allow it to arrive.
    for (let i = 0; i < 20 && latest.get(attackerSocket)?.status !== "ended"; i++) {
      await new Promise(r => setTimeout(r, 20));
    }
    reachedEnd ||= latest.get(attackerSocket)?.status === "ended";
    assert.ok(attacks > 0, "at least one king attack should be made");
    assert.ok(reachedEnd, "a full game must terminate with a winner");
    const finalRoom = latest.get(attackerSocket);
    assert.equal(finalRoom.currentPlayerId, null, "no current turn after victory");
    assert.equal(finalRoom.players.find(p => p.id === opponentId).eliminated, true);
    assert.equal((await emit(attackerSocket, "game:endTurn")).ok, false, "no actions after victory");
  } finally {
    for (const socket of sockets) socket.disconnect();
    child.kill("SIGTERM");
  }
});
