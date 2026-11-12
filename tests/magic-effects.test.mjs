import assert from "node:assert/strict";
import { test } from "node:test";
import { applyMagicFieldEffect, addStatus } from "../server/magic-effects.js";

const unit = (id, rank = "初級", tapped = false) =>
  ({ id, rank, tapped, status: [], type: "步兵" });
const player = (...units) => ({ field: units });

test("fireball and meteor destroy low ranks and debuff stronger ranks", () => {
  const low = unit("low");
  const mid = unit("mid", "中級");
  const high = unit("high", "高級");
  const target = player(low, mid, high);
  applyMagicFieldEffect("流星雨", target, ["low", "mid", "high"]);
  assert.deepEqual(target.field.map(u => u.id), ["mid", "high"]);
  assert.deepEqual(mid.status, ["階級-1"]);
  assert.deepEqual(high.status, ["階級-1"]);
  applyMagicFieldEffect("火球術", target, ["mid"]);
  assert.deepEqual(mid.status, ["階級-1"], "duplicate status has no second implicit stack");
});

test("freeze is not duplicated; high-rank freeze becomes a rank debuff", () => {
  const low = unit("low");
  const high = unit("high", "高級");
  const target = player(low, high);
  applyMagicFieldEffect("冰凍術", target, ["low", "high"]);
  applyMagicFieldEffect("冰凍術", target, ["low", "high"]);
  assert.deepEqual(low.status, ["不能攻擊"]);
  assert.deepEqual(high.status, ["階級-1"]);
});

test("weakness, power, enhancement, poison and blood effects", () => {
  const low = unit("low");
  const high = unit("high", "高級", true);
  const target = player(low, high);
  applyMagicFieldEffect("虛弱術", target, ["low"]);
  assert.deepEqual(low.status, ["階級-1", "不能攻擊"]);
  applyMagicFieldEffect("力量術", target, ["high"]);
  assert.ok(high.status.includes("力量術+1"));
  applyMagicFieldEffect("增強術", target, ["high"]);
  assert.ok(high.status.includes("階級+1"));
  assert.ok(!high.status.includes("傷害+1"), "already tapped units do not gain the extra king damage");
  applyMagicFieldEffect("毒藥瓶", target, ["high"]);
  assert.ok(high.status.includes("下回合死亡"));
  applyMagicFieldEffect("燃血術", target, ["high"]);
  assert.equal(high.tapped, false);
  assert.ok(high.status.includes("燃血+1傷害"));
  addStatus(high, "燃血+1傷害");
  assert.equal(high.status.filter(s => s === "燃血+1傷害").length, 1);
});

test("meteor wipes lower ranks and freezes surviving high ranks", () => {
  const target = player(unit("a"), unit("b", "中級"), unit("c", "高級"));
  const result = applyMagicFieldEffect("天殞術", target, []);
  assert.equal(result.destroyed, 2);
  assert.deepEqual(target.field.map(u => u.id), ["c"]);
  assert.deepEqual(target.field[0].status, ["不能攻擊"]);
});
