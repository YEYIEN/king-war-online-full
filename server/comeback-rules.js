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
