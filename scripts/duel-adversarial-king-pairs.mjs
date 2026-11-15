import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import {simulateKingBaseline} from "../server/index.js";
const kings=["亞歷山大大帝","屋大維奧古斯都","成吉思汗","秦始皇","路易十四"];
const seeds=[1748203,2860217];
const perSeed=Number(process.env.DUEL_ADVERSARIAL_MATCHES||70);
const rules=[
 {id:"original",firstSeatPeacefulTurn:false,firstSeatOpeningHandPenalty:0,secondSeatExtraCards:0},
 {id:"candidate",firstSeatPeacefulTurn:true,firstSeatOpeningHandPenalty:1,secondSeatExtraCards:1}
];
const styles=["balanced","rush","fortress"];
const rows=[];
const sum=(list,fn)=>list.reduce((s,v)=>s+fn(v),0);
const pct=(a,b)=>b?+(100*a/b).toFixed(2):null;
function ci(w,n){if(!n)return null;const z=1.96,p=w/n,d=1+z*z/n,m=(p+z*z/(2*n))/d,e=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return [+(100*(m-e)).toFixed(2),+(100*(m+e)).toFixed(2)]}
for(const rule of rules)for(const style of styles)for(const challengerKing of kings)
  for(const opponentKing of kings.filter(k=>k!==challengerKing)){
    const runs=[];
    for(const seed of seeds){
      const r=await simulateKingBaseline({
        seed,matches:perSeed,playerCount:2,maxTurns:180,
        difficulty:"conqueror",challenger:"conqueror",
        challengerStyle:style,kingPair:[challengerKing,opponentKing],
        includeMatchRecords:true,comebackEnabled:true,
        conquerorProfile:"resource",conquerorSearch:true,
        firstSeatPeacefulTurn:rule.firstSeatPeacefulTurn,
        firstSeatOpeningHandPenalty:rule.firstSeatOpeningHandPenalty,
        secondSeatExtraCards:rule.secondSeatExtraCards
      });
      assert.deepEqual(r.invariantViolations,{},`${rule.id}/${style}/${challengerKing}/${opponentKing}/${seed}`);
      assert.equal(r.finished+r.unfinished,perSeed);
      assert.equal(r.unfinishedReasons.stalledAITurn,0);
      assert.equal(r.matchRecords.length,perSeed);
      runs.push(r);
    }
    const samples=runs.flatMap(r=>r.matchRecords);
    let challengerWins=0,challengerGames=0,seat1Wins=0,seat1Games=0;
    const perSeat={1:{games:0,wins:0},2:{games:0,wins:0}};
    for(const game of samples){
      const chosenSeat=1+game.gameIndex%2;
      const chosen=game.players.find(p=>p.seat===chosenSeat);
      const other=game.players.find(p=>p.seat!==chosenSeat);
      assert.equal(chosen.king,challengerKing,"king-assignment drift");
      assert.equal(other.king,opponentKing,"opponent king drift");
      assert.equal(chosen.researchStyle,style);
      challengerGames++;
      perSeat[chosenSeat].games++;
      if(game.finished && game.winnerSeat===chosenSeat){
        challengerWins++;
        perSeat[chosenSeat].wins++;
      }
      seat1Games++;
      if(game.finished && game.winnerSeat===1)seat1Wins++;
    }
    rows.push({rule:rule.id,style,challengerKing,opponentKing,
      games:challengerGames,challengerWins,challengerRate:pct(challengerWins,challengerGames),
      seat1Wins,seat1Games,seat1Rate:pct(seat1Wins,seat1Games),
      challengerBySeat:perSeat,unfinished:sum(runs,r=>r.unfinished),
      meanTurns:+(runs.reduce((a,r)=>a+r.averageTurns,0)/runs.length).toFixed(2)});
    console.error("PAIR",rule.id,style,challengerKing,opponentKing,
      `${challengerWins}/${challengerGames}`,`seat1:${seat1Wins}/${seat1Games}`);
  }
const aggregate=[];
for(const rule of rules)for(const style of styles){
  const group=rows.filter(r=>r.rule===rule.id&&r.style===style);
  const wins=sum(group,r=>r.seat1Wins),games=sum(group,r=>r.seat1Games);
  const challengerWins=sum(group,r=>r.challengerWins);
  aggregate.push({rule:rule.id,style,games,firstSeatWins:wins,firstSeatRate:pct(wins,games),firstSeatCI95:ci(wins,games),
    challengerWins,challengerRate:pct(challengerWins,games),
    meanTurns:+(group.reduce((a,r)=>a+r.meanTurns,0)/group.length).toFixed(2),
    unfinished:sum(group,r=>r.unfinished),
    maxPairSeatBias:Math.max(...group.map(r=>Math.abs(r.seat1Rate-50)))});
}
const data={study:"ordered king pairing + reversed seats + adversarial rush/fortress duel",
 rules,styles,kings,seeds,perSeed,totalGames:sum(rows,r=>r.games),rows,aggregate,
 notes:[
  "King pair is fixed in the authoritative game before play; challenger seat alternates per match.",
  "Challenger strategy is a research-only deployment and attack scoring bias, not human optimal play.",
  "Challenger win rate and first seat rate are distinct; mixing them leads to false seat conclusions.",
  "All 20 directed king pairs are included. The same seed may diverge after different decisions.",
  "Pair-level rates have fewer games than aggregate and should not be treated as conclusive without further samples."
 ]};
writeFileSync("duel-adversarial-king-pairs.json",JSON.stringify(data,null,2));
const lines=["# Duel initiative: adversarial king-pair stress test","",
 `- ${data.totalGames} matches, ${rows.length} strata; ${perSeed} games x ${seeds.length} seeds per stratum.`,
 "- Experimental rules are simulation-only, not enabled in human rooms.","",
 "| Rule | Challenger style | Games | First-seat win % | Wilson 95% | Challenger win % | Incomplete |",
 "|---|---|---:|---:|---|---:|---:|"];
for(const r of aggregate)lines.push(`| ${r.rule} | ${r.style} | ${r.games} | ${r.firstSeatRate} | ${r.firstSeatCI95.join("–")} | ${r.challengerRate} | ${r.unfinished} |`);
lines.push("","Per-ordered-king-pair and seat-specific results are in the JSON file.");
writeFileSync("duel-adversarial-king-pairs.md",lines.join("\n")+"\n");
console.log(JSON.stringify({totalGames:data.totalGames,aggregate},null,2));
