import assert from "node:assert/strict";
import { simulateKingBaseline } from "../server/index.js";

const seeds=[104729,130363,196613];
const large=Number(process.env.MATCHES_PER_SEED || 300);
const scenarios=[
  { players:2, opponent:"easy" },
  { players:2, opponent:"normal" },
  { players:2, opponent:"hard" },
  { players:3, opponent:"hard" },
  { players:4, opponent:"hard" },
  { players:5, opponent:"hard" }
];
const rows=[];
for(const x of scenarios){
  const runs=[];
  for(const seed of seeds){
    const r=await simulateKingBaseline({
      seed, playerCount:x.players, matches:large, difficulty:x.opponent, challenger:"conqueror",
      maxTurns:180, comebackEnabled:true
    });
    assert.deepEqual(r.invariantViolations,{});
    assert.equal(r.challengerStats.matches,large);
    runs.push(r);
  }
  const sum=fn=>runs.reduce((a,r)=>a+fn(r),0);
  const games=sum(r=>r.challengerStats.matches),wins=sum(r=>r.challengerStats.wins);
  const kingNames=Object.keys(runs[0].kings);
  const kings=Object.fromEntries(kingNames.map(k=>[k,{games:sum(r=>r.challengerStats.gamesByKing[k]||0),
    wins:sum(r=>r.challengerStats.winsByKing[k]||0)}]));
  const seats=Object.fromEntries(Array.from({length:x.players},(_,i)=>String(i+1)).map(seat=>[seat,{
    games:sum(r=>r.challengerStats.gamesBySeat[seat]||0),
    wins:sum(r=>r.challengerStats.winsBySeat[seat]||0)
  }]));
  rows.push({
    ...x,games,wins,winRate:+(100*wins/games).toFixed(2),
    expectedSymmetricRate:+(100/x.players).toFixed(2),
    winRateBySeed:runs.map(r=>({seed:r.seed,wins:r.challengerStats.wins,rate:+(100*r.challengerStats.wins/r.challengerStats.matches).toFixed(2)})),
    kings,seats,
    unfinished:sum(r=>r.challengerStats.unfinished),
    avgTurns:+(sum(r=>r.averageTurns)/runs.length).toFixed(2)
  });
  console.error("SIM",x.players,x.opponent,"Conqueror:",wins,"/",games);
}
console.log(JSON.stringify({methodology:"Only Conqueror has its policy; other players use specified baseline difficulty. Seats rotated and kings assigned by actual game. Equal rules, no hidden-hand access beyond own view. Win rates are simulation-specific.",seeds,matchesPerSeed:large,rows},null,2));
