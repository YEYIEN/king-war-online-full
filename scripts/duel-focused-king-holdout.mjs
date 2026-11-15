import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import {simulateKingBaseline} from "../server/index.js";

const pairs=[
 ["秦始皇","路易十四"],["路易十四","秦始皇"],
 ["成吉思汗","屋大維奧古斯都"],["屋大維奧古斯都","成吉思汗"]
];
const modes=[
 {id:"original",firstSeatPeacefulTurn:false,secondSeatExtraCards:0,firstSeatOpeningHandPenalty:0},
 {id:"candidate",firstSeatPeacefulTurn:true,secondSeatExtraCards:1,firstSeatOpeningHandPenalty:1}
];
const styles=["balanced","fortress"];
const seeds=[3610817,4600021];
const perSeed=Number(process.env.DUEL_FOCUSED_MATCHES_PER_SEED||400);
function rate(a,b){return b?+(100*a/b).toFixed(2):null}
function wilson(w,n){const z=1.96,p=w/n,d=1+z*z/n,m=(p+z*z/(2*n))/d,e=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return [+(100*(m-e)).toFixed(2),+(100*(m+e)).toFixed(2)]}
const rows=[];
for(const mode of modes)for(const style of styles)for(const [challengerKing,opponentKing] of pairs){
 const runs=[];
 for(const seed of seeds){
  const r=await simulateKingBaseline({
   matches:perSeed,seed,playerCount:2,maxTurns:180,
   difficulty:"conqueror",challenger:"conqueror",challengerStyle:style,
   kingPair:[challengerKing,opponentKing],conquerorSearch:true,conquerorProfile:"resource",
   comebackEnabled:true,includeMatchRecords:true,
   firstSeatPeacefulTurn:mode.firstSeatPeacefulTurn,
   secondSeatExtraCards:mode.secondSeatExtraCards,
   firstSeatOpeningHandPenalty:mode.firstSeatOpeningHandPenalty
  });
  assert.deepEqual(r.invariantViolations,{},`${mode.id}/${style}/${challengerKing}/${opponentKing}`);
  assert.equal(r.finished+r.unfinished,perSeed);
  assert.equal(r.unfinishedReasons.stalledAITurn,0);
  runs.push(r);
 }
 const games=runs.flatMap(r=>r.matchRecords);
 const firstWins=games.filter(g=>g.finished&&g.winnerSeat===1).length;
 const challengerBySeat={1:{games:0,wins:0},2:{games:0,wins:0}};
 for(const game of games){
  const seat=1+game.gameIndex%2;
  assert.equal(game.players.find(p=>p.seat===seat).king,challengerKing);
  assert.equal(game.players.find(p=>p.seat!==seat).king,opponentKing);
  challengerBySeat[seat].games++;
  if(game.winnerSeat===seat)challengerBySeat[seat].wins++;
 }
 const r={mode:mode.id,style,challengerKing,opponentKing,games:games.length,
  firstWins,firstRate:rate(firstWins,games.length),ci95:wilson(firstWins,games.length),
  challengerBySeat,meanTurns:+(runs.reduce((s,v)=>s+v.averageTurns,0)/runs.length).toFixed(2),
  unfinished:runs.reduce((s,v)=>s+v.unfinished,0)};
 rows.push(r);
 console.error("FOCUSED",JSON.stringify({mode:r.mode,style:r.style,challengerKing,opponentKing,
  firstRate:r.firstRate,ci95:r.ci95,unfinished:r.unfinished}));
}
const output={scope:"Focused independent king-pair duel opening study",pairs,styles,seeds,perSeed,
 totalGames:rows.reduce((s,r)=>s+r.games,0),rows,
 caveat:"Exploratory AI proxies; single pair effects remain conditional on the opposing Conqueror policy."};
writeFileSync("duel-focused-king-holdout.json",JSON.stringify(output,null,2));
const md=["# Focused duel king matchup validation","",
 `${output.totalGames} games, no change to the official live rule set.`,"",
 "| Rule | Style | Challenger king | Opponent king | Seat1 rate | Wilson 95% | Unfinished |",
 "|---|---|---|---|---:|---|---:|"];
for(const r of rows)md.push(`| ${r.mode} | ${r.style} | ${r.challengerKing} | ${r.opponentKing} | ${r.firstRate}% | ${r.ci95.join("–")}% | ${r.unfinished} |`);
writeFileSync("duel-focused-king-holdout.md",md.join("\n")+"\n");
console.log(JSON.stringify({totalGames:output.totalGames,rows:rows.map(({mode,style,challengerKing,opponentKing,firstRate,ci95})=>({mode,style,challengerKing,opponentKing,firstRate,ci95}))},null,2));
