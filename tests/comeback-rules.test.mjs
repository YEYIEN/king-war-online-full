import assert from "node:assert/strict";
import { test } from "node:test";
import { canUseLastStand } from "../server/comeback-rules.js";

function scenario({ hp = 10, myField = 1, enemyHp = 24, enemyField = 3, turn = "me", enabled = true, used = false, tutorial = false } = {}) {
  const player = { id: "me", hp, field: Array.from({ length: myField }, () => ({})), eliminated: false, lastStandUsed: used };
  const enemy = { id: "enemy", hp: enemyHp, field: Array.from({ length: enemyField }, () => ({})), eliminated: false };
  const room = { status: "playing", currentPlayerId: turn, settings: { comebackEnabled: enabled }, tutorial, players: [player, enemy] };
  return { room, player };
}
test("only a genuinely behind player can use the paid one-time comeback", () => {
  let {room, player} = scenario();
  assert.equal(canUseLastStand(room, player), true);
  ({room, player} = scenario({ hp: 20 }));
  assert.equal(canUseLastStand(room, player), false, "healthy players cannot trigger");
  ({room, player} = scenario({ hp: 3 }));
  assert.equal(canUseLastStand(room, player), false, "cost cannot cause accidental self elimination");
  ({room, player} = scenario({ myField: 4 }));
  assert.equal(canUseLastStand(room, player), false, "strong field blocks comeback");
  ({room, player} = scenario({ hp: 10, enemyHp: 11, enemyField: 2 }));
  assert.equal(canUseLastStand(room, player), false, "no real deficit");
  ({room, player} = scenario({ used: true }));
  assert.equal(canUseLastStand(room, player), false, "cannot trigger twice");
  ({room, player} = scenario({ turn: "enemy" }));
  assert.equal(canUseLastStand(room, player), false, "not another player's turn");
  ({room, player} = scenario({ enabled: false }));
  assert.equal(canUseLastStand(room, player), false, "room can disable experimental mechanic");
  ({room, player} = scenario({ tutorial: true }));
  assert.equal(canUseLastStand(room, player), false, "tutorial never introduces comeback before core rules");
});
