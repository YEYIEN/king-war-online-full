import { simulateKingBaseline } from "../server/index.js";

const matches = Number(process.env.MATCHES || 500);
const players = Number(process.env.PLAYERS || 2);
const maxTurns = Number(process.env.MAX_TURNS || 100);
const seed = Number(process.env.SEED || 104729);
const data = await simulateKingBaseline({ matches, playerCount: players, maxTurns, seed });
console.log(JSON.stringify(data, null, 2));
if (data.finished / data.matches < 0.8) {
  console.error("WARNING: low completion rate; interpret results with caution");
}
