/** Simulation-only outcome analytics; definitions are intentionally explicit. */
export function isSeverelyBehind(room, player) {
  if (!room || !player || player.eliminated || player.hp <= 0 || player.hp > 20) return false;
  const opponents = room.players.filter(p => p.id !== player.id && !p.eliminated && p.hp > 0);
  if (!opponents.length) return false;
  const highHp = Math.max(...opponents.map(p => p.hp));
  const highField = Math.max(...opponents.map(p => p.field.length));
  return (highHp - player.hp >= 8) ||
    (highHp - player.hp >= 3 && highField - player.field.length >= 3);
}

/** Stricter late-game crisis: a wounded king faces a healthier and larger active army.
 * Unlike the broad disadvantage metric, this avoids counting transient resource swings.
 */
export function isCriticalBehind(room, player) {
  if (!room || !player || player.eliminated || player.hp <= 0 || player.hp > 12) return false;
  return room.players.some(opponent => opponent.id !== player.id && !opponent.eliminated &&
    opponent.hp >= player.hp + 12 && opponent.field.length >= player.field.length + 1);
}

/** Record a severe deficit at the BEGINNING of an active player's own turn, after each
 * player has had an initial turn. This avoids marking everyone as behind before acting.
 * A comeback is a win AFTER such a recorded deficit, not simply using a rescue ability. */
export function observeTurnStart(room, player) {
  const progress = room?.simProgress;
  if (!progress || (room.turnsCompleted || 0) < room.players.length) return;
  if (isSeverelyBehind(room, player)) progress.trailingPlayers.add(player.id);
  if ((room.turnsCompleted || 0) >= 2 * room.players.length && isCriticalBehind(room, player)) {
    progress.criticalPlayers.add(player.id);
  }
}

export function analyzeFinalOutcome(room, winnerId) {
  const progress = room.simProgress;
  const trailing = [...(progress?.trailingPlayers || [])];
  const critical = [...(progress?.criticalPlayers || [])];
  return {
    trailingPlayers: trailing.length,
    criticalPlayers: critical.length,
    criticalWin: !!winnerId && critical.includes(winnerId),
    comebackWin: !!winnerId && trailing.includes(winnerId),
    comebackUserWin: !!winnerId && !!room.players.find(p => p.id === winnerId)?.lastStandUsed,
    noComebackWin: !!winnerId && trailing.includes(winnerId) &&
      !room.players.find(p => p.id === winnerId)?.lastStandUsed
  };
}
