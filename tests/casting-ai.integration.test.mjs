import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { test } from "node:test";

const requireClient = createRequire(new URL("../client/package.json", import.meta.url));
const { io } = requireClient("socket.io-client");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function connect(port) {
  const socket = io(`http://127.0.0.1:${port}`, { transports: ["websocket"], reconnection: false, timeout: 1500 });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}

function request(socket, event, data = {}) {
  return new Promise((resolve, reject) => {
    socket.timeout(4000).emit(event, data, (err, result) => err ? reject(err) : resolve(result));
  });
}

async function launch(t, action) {
  const port = await freePort();
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, PORT: String(port), NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const sockets = [];
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  t.after(() => { sockets.forEach(s => s.disconnect()); child.kill("SIGTERM"); });
  let socket;
  for (let i = 0; i < 40; i++) {
    try {
      socket = await connect(port);
      break;
    } catch (error) {
      if (child.exitCode !== null) throw new Error(`Server exited: ${stderr}`);
      if (i === 39) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  sockets.push(socket);
  return action(socket);
}

test("guided tutorial: deploy, choose buff, defeat guard, and end turn", { timeout: 15000 }, async t => {
  await launch(t, async socket => {
    const started = await request(socket, "tutorial:start", { name: "Strategy learner" });
    assert.equal(started.ok, true);
    const { playerId, resumeToken } = started;
    const roomCode = started.room.roomCode;
    const self = started.room.players.find(p => p.id === playerId);
    const enemy = started.room.players.find(p => p.id !== playerId);
    const mage = self.field.find(u => u.type === "法師");
    const cavalry = self.hand.find(u => u.name === "中級騎兵");
    const archer = enemy.field.find(u => u.name === "中級弓兵");
    const spell = self.magic.find(m => m.name === "力量術");
    assert.ok(mage && cavalry && archer && spell, "tutorial provides the precise tactical scenario");
    const state = async () => (await request(socket, "room:resume", { roomCode, playerId, resumeToken })).room;
    assert.equal((await request(socket, "game:castMagic", {
      magicId: spell.id, casterId: mage.id, targetPlayerId: playerId, targetUnitIds: [mage.id]
    })).ok, false, "player must deploy before casting and choose a meaningful target");
    assert.equal((await request(socket, "game:deploy", { cardId: cavalry.id })).ok, true);
    assert.equal((await state()).tutorialProgress, 1);
    const base = { magicId: spell.id, casterId: mage.id, targetPlayerId: playerId, targetUnitIds: [cavalry.id] };
    assert.equal((await request(socket, "game:castMagic", { ...base, targetUnitIds: ["missing"] })).ok, false);
    assert.equal((await request(socket, "game:castMagic", { ...base, targetUnitIds: [cavalry.id, cavalry.id] })).ok, false);
    assert.equal((await request(socket, "game:castMagic", { ...base, targetPlayerId: enemy.id })).ok, false);
    assert.equal((await request(socket, "game:attackUnit", {
      attackerId: cavalry.id, targetPlayerId: enemy.id, defenderId: archer.id
    })).ok, false, "tutorial must explain why buff matters before allowing the attack");
    let room = await state();
    assert.equal(room.players.find(p => p.id === playerId).magic.length, 1);
    assert.equal(room.players.find(p => p.id === playerId).field.find(u => u.id === mage.id).tapped, false);
    assert.equal((await request(socket, "game:castMagic", base)).ok, true);
    room = await state();
    assert.equal(room.tutorialProgress, 2);
    assert.ok(room.players.find(p => p.id === playerId).field.find(u => u.id === cavalry.id).status.includes("力量術+1"));
    assert.equal(room.players.find(p => p.id === playerId).magic.length, 0);
    assert.equal((await request(socket, "game:castMagic", base)).ok, false);
    assert.equal((await request(socket, "game:endTurn")).ok, false, "cannot skip the actual battle lesson");
    assert.equal((await request(socket, "game:attackUnit", {
      attackerId: cavalry.id, targetPlayerId: enemy.id, defenderId: archer.id
    })).ok, true);
    room = await state();
    assert.equal(room.tutorialProgress, 3);
    assert.equal(room.players.find(p => p.id === enemy.id).field.length, 0);
    assert.equal((await request(socket, "game:endTurn")).ok, true);
    // A completed tutorial is intentionally frozen rather than progressing an unseen AI turn.
  });
});

test("single-player AI: automatic AI turn eventually passes back to the human", { timeout: 35000 }, async t => {
  await launch(t, async socket => {
    let latest = null;
    socket.on("room:update", room => { latest = room; });
    const started = await request(socket, "singleplayer:start", { name: "AI tester" });
    assert.equal(started.ok, true);
    const { playerId } = started;
    assert.equal(started.room.players.length, 2);
    const ai = started.room.players.find(p => p.isAI);
    assert.ok(ai);
    let aiSeen = started.room.currentPlayerId === ai.id;
    if (!aiSeen) {
      assert.equal((await request(socket, "game:endTurn")).ok, true);
      aiSeen = true;
    }
    assert.ok(aiSeen);
    // AI has deliberate sleeps for visible actions; allow a complete phase.
    for (let i = 0; i < 290; i++) {
      if (latest?.status === "playing" && latest.currentPlayerId === playerId && latest.log.some(x => x.includes("結束回合"))) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail("AI turn did not return control to the human");
  });
});
