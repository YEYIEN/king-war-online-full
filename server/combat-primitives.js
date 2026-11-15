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
  return Math.max(1, v);
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
    !u.status.includes("疲乏待解");
}

export function battle(a, d) {
  let av = power(a), dv = power(d);
  if (a.counterTarget === d.type) av++;
  if (d.counterTarget === a.type) dv++;
  if (av > dv) return "attacker";
  if (dv > av) return "defender";
  return "both";
}

/** Exact, immutable forecast for one unit-versus-unit attack.
 * The server consumes this same calculation when applying an attack.
 * It deliberately does not forecast card draws, king effects or magic.
 */
export function previewUnitAttack(attacker, defender) {
  const attackerPower=power(attacker);
  const defenderPower=power(defender);
  const verdict=battle(attacker, defender);
  const archerSaved=attacker.type==="弓兵" && defenderPower>=attackerPower;
  const archerExtra=attacker.type==="弓兵" && defenderPower<attackerPower && !attacker.archerBonusUsed;
  return {
    verdict,attackerPower,defenderPower,archerSaved,archerExtra,
    killedEnemy:verdict==="attacker" || verdict==="both",
    killedAttacker:(verdict==="defender" || verdict==="both") && !archerSaved
  };
}
