/**
 * When a finite deck is exhausted, begin a fresh independent draw cycle.
 * Never remove cards held by players or still on the battlefield.
 */
export function replenishDeckIfEmpty(room, deckKey, makeDeck, label) {
  if (!room || !["unitDeck","magicDeck"].includes(deckKey)) throw new Error("Invalid deck");
  if (!Array.isArray(room[deckKey])) room[deckKey] = [];
  if (room[deckKey].length > 0) return false;
  const next = makeDeck();
  if (!Array.isArray(next) || next.length === 0) return false;
  room[deckKey] = next;
  room.deckCycles ??= {unitDeck:0,magicDeck:0};
  room.deckCycles[deckKey] = (room.deckCycles[deckKey] || 0) + 1;
  if (Array.isArray(room.log)) room.log.push(`${label}抽牌堆已用盡，自動洗出新一輪牌庫。`);
  return true;
}
