import { simulateKingBaseline } from "../server/index.js";

const matches = Number(process.env.MATCHES || 500);
const players = Number(process.env.PLAYERS || 2);
const maxTurns = Number(process.env.MAX_TURNS || 100);
const seed = Number(process.env.SEED || 104729);
const difficulty = process.env.DIFFICULTY || "normal";
const louisBonus = process.env.LOUIS_BONUS !== "0";
const louisFreeAction = process.env.LOUIS_FREE_ACTION !== "0";
const qinOpeningBonus = process.env.QIN_OPENING_BONUS === "1";
const genghisDrawLimit = Number(process.env.GENGHIS_DRAW_LIMIT || 2);
const genghisGuaranteedCavalry = process.env.GENGHIS_GUARANTEE !== "0";
const comebackEnabled = process.env.COMEBACK === "1";
const lastStandShieldEnabled = process.env.LAST_STAND_SHIELD !== "0";
const openingTruceEnabled = process.env.OPENING_TRUCE === "1";
const data = await simulateKingBaseline({ matches, playerCount: players, maxTurns, seed, difficulty, louisBonus, louisFreeAction, qinOpeningBonus, genghisDrawLimit, genghisGuaranteedCavalry, comebackEnabled, lastStandShieldEnabled, openingTruceEnabled });
console.log(JSON.stringify(data, null, 2));
if (data.finished / data.matches < 0.8) {
  console.error("WARNING: low completion rate; interpret results with caution");
}
