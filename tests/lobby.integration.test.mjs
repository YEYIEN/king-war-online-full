import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { test } from "node:test";

const requireClient = createRequire(new URL("../client/package.json", import.meta.url));
const { io } = requireClient("socket.io-client");

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function connect(port) {
  const socket = io(`http://127.0.0.1:${port}`, { transports: ["websocket"], reconnection: false, timeout: 3000 });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}

function request(socket, name, payload = {}) {
  return new Promise((resolve, reject) => {
    socket.timeout(3000).emit(name, payload, (err, response) => err ? reject(err) : resolve(response));
  });
}

test("private room readiness, repeated start, and resume safeguards", { timeout: 20000 }, async () => {
  const port = await availablePort();
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, NODE_ENV: "development", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const sockets = [];
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  try {
    let host;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (child.exitCode !== null) throw new Error(`Server exited: ${stderr}`);
      try {
        host = await connect(port);
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    assert.ok(host, `Server did not start: ${stderr}`);
    sockets.push(host);
    const created = await request(host, "room:create", { name: "Host", maxPlayers: 2 });
    assert.equal(created.ok, true);
    const guest = await connect(port);
    sockets.push(guest);
    const joined = await request(guest, "room:join", { name: "Guest", code: created.room.roomCode });
    assert.equal(joined.ok, true);

    assert.equal((await request(host, "game:start")).ok, false, "guest must be ready");
    assert.equal((await request(guest, "room:toggleReady")).ready, true);
    assert.equal((await request(host, "game:start")).ok, true);
    const repeated = await request(host, "game:start");
    assert.equal(repeated.ok, false, "a playing room cannot be restarted");
    assert.match(repeated.error, /已開始|已結束/);
    const readyAfterStart = await request(guest, "room:toggleReady");
    assert.equal(readyAfterStart.ok, false, "readiness cannot change during a game");

    const duplicate = await connect(port);
    sockets.push(duplicate);
    const takeover = await request(duplicate, "room:resume", {
      roomCode: created.room.roomCode,
      playerId: joined.playerId
    });
    assert.equal(takeover.ok, false, "an active connection cannot be taken over");
    const hostResume = await request(host, "room:resume", {
      roomCode: created.room.roomCode,
      playerId: created.playerId
    });
    assert.equal(hostResume.ok, true, "the same connected socket can resume");

    // Human attacks: first-turn reinforcement makes a freshly deployed low/mid unit actionable.
    // Select the actual current player because player order is randomized on game start.
    const startedRoom = hostResume.room;
    const firstId = startedRoom.currentPlayerId;
    const firstSocket = firstId === created.playerId ? host : guest;
    const firstSnapshot = firstId === created.playerId
      ? startedRoom
      : (await request(guest, "room:resume", {
          roomCode: created.room.roomCode, playerId: joined.playerId
        })).room;
    const active = firstSnapshot.players.find(p => p.id === firstId);
    const defender = firstSnapshot.players.find(p => p.id !== firstId);
    const playable = active.hand.find(card => card.rank !== "高級");
    assert.ok(playable, "first player's opening hand should contain an eligible initial unit");
    assert.equal((await request(firstSocket, "game:deploy", { cardId: playable.id })).ok, true);
    const invalidUnit = await request(firstSocket, "game:attackUnit", {
      attackerId: playable.id, targetPlayerId: defender.id, defenderId: "missing"
    });
    assert.equal(invalidUnit.ok, false, "combat must reject a nonexistent defender");
    const kingAttack = await request(firstSocket, "game:attackKing", {
      attackerId: playable.id, targetPlayerId: defender.id
    });
    assert.equal(kingAttack.ok, true, "reinforced first unit may attack an unguarded king");
    assert.equal((await request(firstSocket, "game:attackKing", {
      attackerId: playable.id, targetPlayerId: defender.id
    })).ok, false, "a unit cannot attack twice without a reset");

    // Verify lobby host transfer and cleanup when the final human exits.
    const lobbyHost = await connect(port);
    sockets.push(lobbyHost);
    const lobbyCreated = await request(lobbyHost, "room:create", { name: "LobbyHost", maxPlayers: 2 });
    const lobbyGuest = await connect(port);
    sockets.push(lobbyGuest);
    const lobbyJoined = await request(lobbyGuest, "room:join", {
      name: "LobbyGuest", code: lobbyCreated.room.roomCode
    });
    assert.equal(lobbyJoined.ok, true);
    assert.equal((await request(lobbyHost, "room:leave")).ok, true);
    const transferred = await request(lobbyGuest, "room:resume", {
      roomCode: lobbyCreated.room.roomCode,
      playerId: lobbyJoined.playerId
    });
    assert.equal(transferred.ok, true);
    assert.equal(transferred.room.hostId, lobbyJoined.playerId, "remaining guest inherits host role");
    assert.equal(transferred.room.players.length, 1, "departing lobby player is removed");
    assert.equal((await request(lobbyGuest, "room:leave")).ok, true);

    const checkDeleted = await connect(port);
    sockets.push(checkDeleted);
    const nonexistent = await request(checkDeleted, "room:join", {
      name: "Late", code: lobbyCreated.room.roomCode
    });
    assert.equal(nonexistent.ok, false, "empty lobby should be deleted");
  } finally {
    sockets.forEach(socket => socket.disconnect());
    child.kill("SIGTERM");
  }
});
