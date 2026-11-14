/**
 * Once-per-match comeback action availability.
 * The player must be genuinely behind in health or board, and pay a nonzero cost.
 */
export function canUseLastStand(room, player) {
  if (!room || !player || room.status !== "playing") return false;
  if (room.tutorial || room.settings?.comebackEnabled === false) return false;
  if (room.currentPlayerId !== player.id || player.eliminated || player.lastStandUsed) return false;
  if (player.hp <= 3 || player.hp > 12 || player.field.length > 2) return false;
  return room.players.some(opponent =>
    opponent.id !== player.id && !opponent.eliminated && opponent.hp > 0 &&
    (opponent.hp >= player.hp + 6 || opponent.field.length >= player.field.length + 2)
  );
}

/** Absorb up to the remaining royal shield, but every successful attack still deals >=1 HP. */
export function mitigateKingDamage(defender, rawDamage) {
  const amount = Math.max(0, Number(rawDamage) || 0);
  if (!amount || !defender?.lastStandShield) return amount;
  const prevented = Math.min(defender.lastStandShield, Math.max(0, amount - 1));
  defender.lastStandShield -= prevented;
  return amount - prevented;
}
