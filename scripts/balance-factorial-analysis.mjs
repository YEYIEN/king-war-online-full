import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";

const data=JSON.parse(readFileSync("balance-factorial-raw.json","utf8"));
const scenarios=new Map(data.scenarios.map(s=>[s.scenario,s]));
const pct=(w,n)=>n?100*w/n:null;
const n2=x=>x===null?null:+x.toFixed(2);
const diff=(a,b)=>a!==null&&b!==null?n2(a-b):null;
const row=(id,label)=>{const scenario=scenarios.get(id);assert.ok(scenario,`missing ${id}`);return {label,scenario};};
const contrasts=[
 ["duel-hard-baseline","duel-hard-truce-only","Duel Hard: first-turn non-attack"],
 ["duel-hard-baseline","duel-hard-card-only","Duel Hard: second extra unit card"],
 ["duel-hard-baseline","duel-hard-combined","Duel Hard: combined candidate"],
 ["duel-conqueror-baseline","duel-conqueror-truce-only","Duel Conqueror: first-turn non-attack"],
 ["duel-conqueror-baseline","duel-conqueror-card-only","Duel Conqueror: second extra unit card"],
 ["duel-conqueror-baseline","duel-conqueror-combined","Duel Conqueror: combined candidate"],
 ["p4-normal-baseline","p4-normal-louis-mage","Four Normal: Louis mage setup AI-only"],
 ["p5-normal-baseline","p5-normal-louis-mage","Five Normal: Louis mage setup AI-only"],
 ["p4-normal-baseline","p4-normal-magic-targeting","Four Normal: best spell target AI-only"],
 ["p5-normal-baseline","p5-normal-magic-targeting","Five Normal: best spell target AI-only"],
 ["p5-hard-baseline","p5-hard-no-laststand","Five Hard: no last stand"],
 ["p5-conqueror-baseline","p5-conqueror-no-laststand","Five Conqueror: no last stand"],
 ["p5-hard-baseline","p5-hard-defense-rally-experiment","Five Hard: defensive rally candidate"],
 ["p5-conqueror-baseline","p5-conqueror-defense-rally-experiment","Five Conqueror: defensive rally candidate"]
];
const comparisons=contrasts.map(([base,candidate,label])=>{
 const a=scenarios.get(base),b=scenarios.get(candidate);
 assert.ok(a&&b,`missing contrast ${base}/${candidate}`);
 const focus=label.includes("Louis")||label.includes("spell target")?"路易十四":null;
 const aRate=focus?a.byKing[focus].winRate:a.bySeat["1"].winRate;
 const bRate=focus?b.byKing[focus].winRate:b.bySeat["1"].winRate;
 const aCrisis=a.crises.winRate,bCrisis=b.crises.winRate;
 return {label,baseline:base,candidate,focus:focus||"seat1",baselineWinPct:aRate,candidateWinPct:bRate,
  changePp:diff(bRate,aRate),changeInCriticalComebackPp:diff(bCrisis,aCrisis),
  baselineCrisis:`${a.crises.wins}/${a.crises.eligibleMatches}`,
  candidateCrisis:`${b.crises.wins}/${b.crises.eligibleMatches}`,
  turnsChange:n2(b.averageTurns-a.averageTurns),
  unfinshedChange:b.unfinished-a.unfinished,
  note:"Exploratory comparison; same seed values do not guarantee paired random streams"
 };
});
const current=[...scenarios.values()].filter(s=>s.scenario.endsWith("-baseline"));
const anomalies=[];
for(const sc of current){
 const expected=100/sc.playerCount;
 const kingOutliers=Object.entries(sc.byKing)
  .filter(([,v])=>v.games>=150)
  .map(([name,v])=>({name,rate:v.winRate,games:v.games,ci95:v.ci95,deltaPp:n2(v.winRate-expected)}))
  .sort((a,b)=>Math.abs(b.deltaPp)-Math.abs(a.deltaPp));
 const seatOutliers=Object.entries(sc.bySeat)
  .filter(([,v])=>v.games>=150)
  .map(([seat,v])=>({seat,rate:v.winRate,games:v.games,ci95:v.ci95,deltaPp:n2(v.winRate-expected)}))
  .sort((a,b)=>Math.abs(b.deltaPp)-Math.abs(a.deltaPp));
 anomalies.push({scenario:sc.scenario,playerCount:sc.playerCount,expectedWinPct:n2(expected),
  strongestKing:kingOutliers[0],weakestKing:kingOutliers.sort((a,b)=>a.rate-b.rate)[0],
  mostBiasedSeat:seatOutliers[0],criticalComeback:sc.crises,
  matchCompletion:n2(100*sc.finished/sc.matches),meanTurns:sc.averageTurns
 });
}
const indicators=[
 {id:"initialInfantry",yes:p=>(p.startingTypes["步兵"]||0)>0},
 {id:"initialCavalry",yes:p=>(p.startingTypes["騎兵"]||0)>0},
 {id:"initialMage",yes:p=>(p.startingTypes["法師"]||0)>0},
 {id:"initialHighRank",yes:p=>(p.startingRanks["高級"]||0)>0},
 {id:"initialTwoHighRanks",yes:p=>(p.startingRanks["高級"]||0)>=2}
];
const openingSignals=[];
for(const {id,yes} of indicators){
 const groups=new Map();
 for(const scenario of current)for(const game of scenario.matchRecords){
  if(!game.finished)continue;
  for(const player of game.players){
   const key=`${scenario.scenario}|${player.king}|${player.seat}`;
   const k=groups.get(key)||{yes:0,yesWins:0,no:0,noWins:0};
   const flag=yes(player);
   const win=game.winnerSeat===player.seat;
   if(flag){k.yes++;if(win)k.yesWins++;}
   else{k.no++;if(win)k.noWins++;}
   groups.set(key,k);
  }
 }
 let numerator=0,weight=0,positive=0,negative=0,eligible=0;
 for(const g of groups.values())if(g.yes>=8&&g.no>=8){
  const delta=(g.yesWins/g.yes-g.noWins/g.no)*100;
  const w=Math.min(g.yes,g.no);
  numerator+=delta*w;weight+=w;eligible++;if(delta>0)positive++;if(delta<0)negative++;
 }
 openingSignals.push({indicator:id,weightedConditionalWinGapPp:weight?n2(numerator/weight):null,
  eligibleKingSeatScenarioStrata:eligible,positiveStrata:positive,negativeStrata:negative,
  caveat:"Association only, conditioning on scenario, king, and seat; not randomized intervention"});
}
const wins=data.scenarios.reduce((n,s)=>n+s.matchRecords.filter(r=>r.finished).length,0);
const total=data.scenarios.reduce((n,s)=>n+s.matchRecords.length,0);
assert.equal(total,data.scenarios.reduce((n,s)=>n+s.matches,0));
assert.equal(wins,data.scenarios.reduce((n,s)=>n+s.finished,0));
for(const s of data.scenarios)assert.equal(s.matchRecords.length,s.matches);
const output={source:"balance-factorial-raw.json",simulationVersion:data.schema,
 matches:total,finished:wins,scenarios:data.scenarios.length,
 comparisons,anomalies,openingSignals,
 validity:[
  "These studies are from identical rules and algorithmic AI, not human observations.",
  "Experimental toggles change game rules only inside isolated headless simulations.",
  "Unfinished results have no winner and remain in denominators.",
  "Opening signals are observational even after conditioning on king and seat.",
  "All comparisons are exploratory; conduct holdout trials and adjust for multiple comparisons before selecting a rule change."
 ]};
writeFileSync("balance-factorial-analysis.json",JSON.stringify(output,null,2));
const markdown=["# 《國王戰爭》平衡因素多情境研究｜自動分析", "",
 `研究分支：PR #7（Draft）；${total} 局／${data.scenarios.length} 情境，完成 ${wins} 局。`,
 "## 方案對照（差異：百分點）","",
 "| 實驗 | 控制組 | 候選 | 勝率差 | 危機翻盤差 | 局長差 |","|---|---:|---:|---:|---:|---:|"];
for(const c of comparisons)markdown.push(`| ${c.label} | ${c.baselineWinPct??"—"}% | ${c.candidateWinPct??"—"}% | ${c.changePp??"—"} | ${c.changeInCriticalComebackPp??"—"} | ${c.turnsChange} |`);
markdown.push("","## 開局手牌條件關聯（控制模式、國王及座位，仍不代表因果）","","| 條件 | 分層勝率差（百分點） | 有效分層數 |","|---|---:|---:|");
for(const s of openingSignals)markdown.push(`| ${s.indicator} | ${s.weightedConditionalWinGapPp??"—"} | ${s.eligibleKingSeatScenarioStrata} |`);
markdown.push("","## 重要限制","","- 這些不是正式採用的平衡數值變更。","- 模擬存在 AI 強度與座位相依性；先/後手與國王分配因數要分開比較。","- 方案篩選後仍需獨立種子測試，不能只憑探索資料決策。","- 缺乏真人樣本，無法直接聲稱真人平衡。");
writeFileSync("balance-factorial-analysis.md",markdown.join("\n")+"\n");
console.log(JSON.stringify({matches:total,finished:wins,comparisons,openingSignals,anomalies},null,2));
