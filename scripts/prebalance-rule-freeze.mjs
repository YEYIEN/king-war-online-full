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
 ["turn-effects","function startTurn(room, p)","function rankValue(rank)"],
 ["last-stand","function useLastStand(room, player, mode = \"assault\")","function startGame(room)"]
];
for(const [label,begin,end] of slices){
 function extract(source){
  const a=source.indexOf(begin),b=source.indexOf(end,a+begin.length);
  assert.ok(a>=0 && b>a,`missing ${label} source anchors`);
  return source.slice(a,b);
 }
 assert.equal(extract(current),extract(original),`balance-affecting rule changed without design review: ${label}`);
 console.error("RULE-FREEZE PASS",label);
}
const comeback=readFileSync("server/comeback-rules.js","utf8");
const oldComeback=execFileSync("git",["show",`${base}:server/comeback-rules.js`],{encoding:"utf8"});
assert.equal(comeback,oldComeback,"comeback rule changed; requires explicit balance phase");
console.log("Balance rule freeze passed: no king, card, opening, turn-resource or comeback changes");
