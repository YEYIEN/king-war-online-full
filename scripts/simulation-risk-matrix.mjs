import assert from "node:assert/strict";
import { simulateKingBaseline } from "../server/index.js";

const seeds = [104729, 130363, 196613];
const sample = Number(process.env.SAMPLE_PER_CELL || 120);
const matrix = [];
const scenarios = [];
for (const playerCount of [2, 3, 4, 5]) for (const difficulty of ["easy", "normal", "hard"]) {
  scenarios.push({ name: `${playerCount}p/${difficulty}`, playerCount, difficulty, comebackEnabled: true });
}
scenarios.push(
  { name: "2p/hard-fair", playerCount: 2, difficulty: "hard", comebackEnabled: true,
    firstSeatPeacefulTurn: true, secondSeatExtraCards: 1 },
  { name: "5p/hard-no-comeback", playerCount: 5, difficulty: "hard", comebackEnabled: false },
  { name: "5p/hard-genghis-threat-off", playerCount: 5, difficulty: "hard", comebackEnabled: true, genghisThreatWeight: 0 }
);
for (const setting of scenarios) {
  const runs = [];
  for (const seed of seeds) {
    const result = await simulateKingBaseline({ ...setting, seed, matches: sample, maxTurns: 130 });
    assert.deepEqual(result.invariantViolations, {}, `invariant violation in ${setting.name} seed=${seed}`);
    assert.equal(Object.values(result.turnsHistogram).reduce((a,b) => a+b, 0), sample);
    assert.equal(result.finished + result.unfinished, sample);
    assert.equal(Object.values(result.kings).reduce((a,v)=>a+v.wins,0),result.finished);
    runs.push(result);
  }
  const total = sample * seeds.length;
  const kingNames = Object.keys(runs[0].kings);
  const sum = fn => runs.reduce((acc,run)=>acc + fn(run),0);
  matrix.push({
    scenario: setting.name, matches: total,
    completed: sum(r=>r.finished), unfinished: sum(r=>r.unfinished),
    avgTurns: +(sum(r=>r.averageTurns)/runs.length).toFixed(2),
    seatWinRates: Object.fromEntries(Object.keys(runs[0].seats).map(k => [k, +(
      100 * sum(r=>r.seats[k].wins)/sum(r=>r.seats[k].games)).toFixed(2)])),
    kingWinRates: Object.fromEntries(kingNames.map(k => [k, +(
      100 * sum(r=>r.kings[k].wins)/sum(r=>r.kings[k].games)).toFixed(2)])),
    comebackUse: {
      assault:sum(r=>r.comebackUse.assault), defense:sum(r=>r.comebackUse.defense),
      winningAssault:sum(r=>r.comebackWinsByMode.assault),
      winningDefense:sum(r=>r.comebackWinsByMode.defense)
    },
    events: {
      unitAttacks:sum(r=>r.telemetry.unitAttacks),
      mutualKills:sum(r=>r.telemetry.mutualKills),
      kingAttacks:sum(r=>r.telemetry.kingAttacks),
      kingDamage:sum(r=>r.telemetry.kingDamage),
      spellCasts:sum(r=>Object.values(r.telemetry.spells).reduce((a,b)=>a+b,0)),
      aiDeployments:sum(r=>r.telemetry.aiDeployments),
      mongolRecalls:sum(r=>r.telemetry.mongolRecalls)
    },
    turnDistribution: Object.fromEntries(Object.keys(runs[0].turnsHistogram).map(k=>[k,sum(r=>r.turnsHistogram[k])])),
    seedResults:runs.map(r=>({seed:r.seed,unfinished:r.unfinished,seat1:r.seats["1"].winRate,
      kings:Object.fromEntries(Object.entries(r.kings).map(([k,v])=>[k,v.winRate]))}))
  });
}
console.log(JSON.stringify({description:"Headless server-AI risk matrix with independent deterministic seeds; simulations, not real human games",
  seeds, samplePerSeed:sample, scenarios:matrix},null,2));
