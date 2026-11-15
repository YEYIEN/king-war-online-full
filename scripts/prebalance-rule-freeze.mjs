import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
const base=process.env.KW_BALANCE_BASE_REF || "FETCH_HEAD";
const current=readFileSync("server/index.js","utf8");
const original=execFileSync("git",["show",`${base}:server/index.js`],{encoding:"utf8"});
const slices=[
 ["card-and-king-definitions","const TYPES =","function shuffle(a)"],
 ["deck-generation","function makeUnits()","const maxHand ="],
 ["opening-and-drawing","const maxHand =","function finishIfGameOver"],
 ["turn-effects","function startTurn(room, p)","function mageCanCast("],
 ["last-stand","function useLastStand(room, player, mode = \"assault\")","function startGame(room)"]
];
for(const [label,begin,end] of slices){
 function extract(source){
  const a=source.indexOf(begin),b=source.indexOf(end,a+begin.length);
  assert.ok(a>=0 && b>a,`missing ${label} source anchors`);
  return source.slice(a,b);
 }
 let baseSlice=extract(original);
 if(label==="turn-effects"){
   // Pure combat helpers were moved verbatim into combat-primitives.js.
   const from=baseSlice.indexOf("function rankValue(rank) {");
   assert.ok(from>0,"missing original combat section");
   baseSlice=baseSlice.slice(0,from);
   let newSlice=extract(current);
   // Research-only opening draw penalty must never affect the live/default rules.
   const openingGuard=String.raw`  const openingDrawPenalty=(process.env.KW_SIMULATION==="1" && room.players.length===2 &&`;
   assert.ok(newSlice.includes(openingGuard),"opening compensation missing its simulation-only guard");
   const fromOpening=newSlice.indexOf(openingGuard);
   const endOpening=newSlice.indexOf("  drawUnits(room, p, ud);",fromOpening);
   assert.ok(endOpening>fromOpening,"opening guard calculation not found");
   newSlice=newSlice.slice(0,fromOpening)+
     `  const ud = p.king?.name === "秦始皇" ? 2 : 1;\n  drawUnits(room, p, ud);`+
     newSlice.slice(endOpening+"  drawUnits(room, p, ud);".length);
   assert.equal(newSlice,baseSlice,`balance-affecting turn rule changed: ${label}`);
 } else {
   assert.equal(extract(current),baseSlice,`balance-affecting rule changed without design review: ${label}`);
 }
 console.error("RULE-FREEZE PASS",label);
}
const comeback=readFileSync("server/comeback-rules.js","utf8");
const oldComeback=execFileSync("git",["show",`${base}:server/comeback-rules.js`],{encoding:"utf8"});
assert.equal(comeback,oldComeback,"comeback rule changed; requires explicit balance phase");
console.log("Balance rule freeze passed: no king, card, opening, turn-resource or comeback changes");

const primitives=readFileSync("server/combat-primitives.js","utf8");
for(const fn of ["rankValue","power","effectiveDamage","canAttack","battle"]){
 assert.match(primitives,new RegExp(`export function ${fn}\\(`),`missing extracted primitive ${fn}`);
}
const originalCombat=original.slice(original.indexOf("function rankValue(rank) {"),original.indexOf("function mageCanCast("));
const currentCombat=primitives.slice(primitives.indexOf("export function rankValue(rank) {"),primitives.indexOf("/** Exact, immutable forecast"));
assert.ok(originalCombat.length>100 && currentCombat.length>100,"combat section extraction failed");
const normalized=source=>source
  .replace(/\bexport\s+/g,"")
  .replace(/\/\*[\s\S]*?\*\//g,"")
  .replace(/\/\/[^\n]*/g,"")
  .replace(/\s+/g,"");
assert.equal(normalized(currentCombat),normalized(originalCombat),
  "shared combat power, readiness and counter definitions drifted from baseline");
console.log("Shared deterministic combat primitives match frozen baseline definitions");
