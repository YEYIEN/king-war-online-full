/**
 * Shared, deterministic combat primitives for the authoritative server and AI.
 * Deliberately no random numbers, networking, room mutations or hidden card data.
 * This extraction retains the existing rules verbatim.
 */
export function rankValue(rank) {
  if (rank === "高級") return 3;
  if (rank === "中級") return 2;
  return 1;
}

export function power(u) {
  let v = rankValue(u.rank);
  if (u.status.includes("整備")) v--;
  if (u.status.includes("階級-1")) v--;
  if (u.status.includes("階級+1")) v++;
  if (u.status.includes("力量術+1")) v++;
  if (u.status.includes("屋大維+1")) v++;
  // Combat recovery penalties apply after existing rank/spell minimum, so a rank-1 unit can reach 0.
  v = Math.max(1, v);
  if (u.status.includes("半整備")) v--;
  if (u.status.includes("高整備")) v--;
  return Math.max(0, v);
}

export function effectiveDamage(unit) {
  let dmg = unit?.damage || 0;
  if (unit?.status?.includes("傷害+1")) dmg += 1;
  if (unit?.status?.includes("燃血+1傷害")) dmg += 1;
  return dmg;
}

export function canAttack(u) {
  return !!u &&
    !u.tapped &&
    !u.status.includes("整備") &&
    !u.status.includes("不能攻擊") &&
    !u.status.includes("疲乏") &&
    !u.status.includes("疲乏待解") &&
    !u.status.includes("高整備");
}

export function combatPowers(a, d) {
  let attackerPower = power(a), defenderPower = power(d);
  // Type advantage only applies to this specific matchup; never persist it on the card.
  if (a.counterTarget === d.type) attackerPower++;
  if (d.counterTarget === a.type) defenderPower++;
  return { attackerPower, defenderPower };
}

export function battle(a, d) {
  const { attackerPower, defenderPower } = combatPowers(a, d);
  if (attackerPower > defenderPower) return "attacker";
  if (defenderPower > attackerPower) return "defender";
  return "both";
}

/** Immutable preview; archer passive applies ONLY when the archer initiates. */
export function previewUnitAttack(attacker, defender) {
  const { attackerPower, defenderPower } = combatPowers(attacker, defender);
  const verdict = attackerPower > defenderPower ? "attacker"
    : attackerPower < defenderPower ? "defender" : "both";
  const archerSaved = attacker.type === "弓兵" && verdict !== "attacker";
  const archerExtra = attacker.type === "弓兵" && verdict === "attacker" && !attacker.archerBonusUsed;
  return {
    verdict, attackerPower, defenderPower, archerSaved, archerExtra,
    killedEnemy: verdict === "attacker" || verdict === "both",
    killedAttacker: verdict !== "attacker" && !archerSaved
  };
}
