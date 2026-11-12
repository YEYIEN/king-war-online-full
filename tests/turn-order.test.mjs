import assert from "node:assert/strict";
import { test } from "node:test";
import { nextLivingPlayer } from "../server/turn-order.js";

function players() {
  return ["A", "B", "C", "D"].map(id => ({ id, hp: 30, eliminated: false }));
}
test("turns advance clockwise even when current seat is eliminated", () => {
  const group = players();
  group[1].eliminated = true;
  group[1].hp = 0;
  assert.equal(nextLivingPlayer(group, "B")?.id, "C");
  assert.equal(nextLivingPlayer(group, "D")?.id, "A");
  group[2].eliminated = true;
  assert.equal(nextLivingPlayer(group, "B")?.id, "D");
});
test("no survivor returns null, and an absent previous id starts from seat zero", () => {
  const group = players();
  assert.equal(nextLivingPlayer(group, "unknown")?.id, "A");
  group.forEach(p => { p.hp = 0; p.eliminated = true; });
  assert.equal(nextLivingPlayer(group, "A"), null);
});
