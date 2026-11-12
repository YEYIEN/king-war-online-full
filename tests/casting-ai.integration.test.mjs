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

test("tutorial magic: failed casts preserve card, successful casts consume exactly once", { timeout: 15000 }, async t => {
  await launch(t, async socket => {
    const started = await request(socket, "tutorial:start", { name: "Spell tester" });
    assert.equal(started.ok, true);
    const { playerId, roomCode, resumeToken } = { playerId: started.playerId, roomCode: started.room.roomCode, resumeToken: started.resumeToken };
    const self = started.room.players.find(p => p.id === playerId);
    const mage = self.field.find(u => u.type === "法師");
    const spell = self.magic.find(m => m.name === "力量術");
    assert.ok(mage && spell, "tutorial supplies a caster and power spell");

    const base = { magicId: spell.id, casterId: mage.id, targetPlayerId: playerId, targetUnitIds: [mage.id] };
    assert.equal((await request(socket, "game:castMagic", { ...base, targetUnitIds: ["missing"] })).ok, false);
    assert.equal((await request(socket, "game:castMagic", { ...base, targetUnitIds: [mage.id, mage.id] })).ok, false);
    assert.equal((await request(socket, "game:castMagic", { ...base, targetPlayerId: started.room.players.find(p => p.id !== playerId).id })).ok, false);

    let snapshot = (await request(socket, "room:resume", { playerId, roomCode, resumeToken })).room;
    let me = snapshot.players.find(p => p.id === playerId);
    assert.equal(me.magic.length, 1, "invalid casts must not spend a card");
    assert.equal(me.field.find(u => u.id === mage.id).tapped, false, "invalid casts must not tap caster");

    assert.equal((await request(socket, "game:castMagic", base)).ok, true);
    snapshot = (await request(socket, "room:resume", { playerId, roomCode, resumeToken })).room;
    me = snapshot.players.find(p => p.id === playerId);
    assert.equal(me.magic.length, 0, "successful spell is consumed");
    assert.ok(me.field.find(u => u.id === mage.id).status.includes("力量術+1"), "spell actually applies");
    assert.equal(me.field.find(u => u.id === mage.id).tapped, true, "casting uses caster action");
    assert.equal((await request(socket, "game:castMagic", base)).ok, false, "cannot cast used card again");
    // Exercise end-of-turn cleanup without triggering the tutorial AI's long animation.
    assert.equal((await request(socket, "game:endTurn")).ok, true);
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
