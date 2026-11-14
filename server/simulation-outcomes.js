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

/** Record a severe deficit at the BEGINNING of an active player's own turn, after each
 * player has had an initial turn. This avoids marking everyone as behind before acting.
 * A comeback is a win AFTER such a recorded deficit, not simply using a rescue ability. */
export function observeTurnStart(room, player) {
  const progress = room?.simProgress;
  if (!progress || (room.turnsCompleted || 0) < room.players.length) return;
  if (isSeverelyBehind(room, player)) progress.trailingPlayers.add(player.id);
}

export function analyzeFinalOutcome(room, winnerId) {
  const progress = room.simProgress;
  const trailing = [...(progress?.trailingPlayers || [])];
  return {
    trailingPlayers: trailing.length,
    comebackWin: !!winnerId && trailing.includes(winnerId),
    comebackUserWin: !!winnerId && !!room.players.find(p => p.id === winnerId)?.lastStandUsed,
    noComebackWin: !!winnerId && trailing.includes(winnerId) &&
      !room.players.find(p => p.id === winnerId)?.lastStandUsed
  };
}
