// Player order is the immutable seat order; defeated seats are skipped.
export function nextLivingPlayer(players, currentId) {
  if (!Array.isArray(players) || players.length === 0) return null;
  const index = players.findIndex(player => player.id === currentId);
  for (let offset = 1; offset <= players.length; offset++) {
    const next = players[(index + offset + players.length) % players.length];
    if (!next.eliminated && next.hp > 0) return next;
  }
  return null;
}
