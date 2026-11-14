import assert from "node:assert/strict";
import {simulateKingBaseline} from "../server/index.js";
/**
 * Frozen, new-seed release balance audit: descriptive evidence, never auto-buffs
 * kings. Use each king's actual participation count, not total match count.
 */
const seeds=[314159,271828,161803];
const perSeed=Math.max(30,Number(process.env.BALANCE_MATCHES_PER_SEED||150));
const rows=[];
const wilson=(wins,n)=>{if(!n)return null;const z=1.96,p=wins/n,den=1+z*z/n;
 const c=(p+z*z/(2*n))/den;
 const d=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;
 return [+(100*(c-d)).toFixed(1),+(100*(c+d)).toFixed(1)];};
for(const players of [2,3,4,5])for(const difficulty of ["normal","hard","conqueror"]) {
 const runs=[];
 for(const seed of seeds) {
  const r=await simulateKingBaseline({matches:perSeed,playerCount:players,difficulty,seed,
    comebackEnabled:true,maxTurns:180});
  assert.deepEqual(r.invariantViolations,{},`invariant mismatch ${players} ${difficulty}`);
  runs.push(r);
 }
 const sum=f=>runs.reduce((a,r)=>a+f(r),0);
 const games=perSeed*seeds.length,finished=sum(r=>r.finished);
 const kings={};
 for(const name of Object.keys(runs[0].kings)){
  const appearances=sum(r=>r.kings[name].games),wins=sum(r=>r.kings[name].wins);
  kings[name]={appearances,wins,rate:+(wins*100/appearances).toFixed(2),ci95:wilson(wins,appearances)};
 }
 const seats={};
 for(const n of Object.keys(runs[0].seats)){
  const appearances=sum(r=>r.seats[n].games),wins=sum(r=>r.seats[n].wins);
  seats[n]={appearances,wins,rate:+(wins*100/appearances).toFixed(2),ci95:wilson(wins,appearances)};
 }
 const crisis=sum(r=>r.resultMetrics.completedMatchesWithCriticalPlayer);
 const criticalWins=sum(r=>r.resultMetrics.criticalComebackWins);
 const cast={},effective={};
 for(const r of runs){
  for(const [name,n] of Object.entries(r.telemetry.spells))cast[name]=(cast[name]||0)+n;
  for(const [name,n] of Object.entries(r.telemetry.spellsEffective||{}))effective[name]=(effective[name]||0)+n;
 }
 rows.push({players,difficulty,games,finished,unfinished:games-finished,
  averagePlayerActionTurns:+(sum(r=>r.averageTurns)/runs.length).toFixed(2),
  kings,seats,criticalCrisisGames:crisis,criticalComebackWins:criticalWins,
  criticalComebackRate:crisis?+(criticalWins*100/crisis).toFixed(2):null,
  spellBoardChangeRate:Object.fromEntries(Object.entries(cast).map(([name,n])=>
   [name,{casts:n,changedBoard:effective[name]||0,rate:n?+((effective[name]||0)*100/n).toFixed(1):0}]))});
 console.error("Audited",players,difficulty,finished,"/",games);
}
console.log(JSON.stringify({methodology:"Real server game rules, 3 independent seeds, AI-vs-AI only, full action-turn semantics, king participation denominators, no humans",seeds,perSeed,rows},null,2));
