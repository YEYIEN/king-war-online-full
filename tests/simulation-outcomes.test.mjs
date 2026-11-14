import assert from "node:assert/strict";
import { test } from "node:test";
import { isSeverelyBehind, observeTurnStart, analyzeFinalOutcome } from "../server/simulation-outcomes.js";
const p=(id,hp,field=0)=>({id,hp,field:Array.from({length:field},(_,i)=>({id:`${id}-${i}`})),eliminated:false});
const make=()=>({players:[p("a",10,1),p("b",25,4)],turnsCompleted:2,simProgress:{trailingPlayers:new Set()}});
test("severe comeback counts deficit at start of own eligible turn and requires eventual victory",()=>{
 const room=make(),a=room.players[0];
 assert.equal(isSeverelyBehind(room,a),true);
 assert.equal(isSeverelyBehind(room,room.players[1]),false);
 room.turnsCompleted=1;observeTurnStart(room,a);
 assert.equal(room.simProgress.trailingPlayers.size,0,"ignore opening partial rotation");
 room.turnsCompleted=2;observeTurnStart(room,a);
 assert.deepEqual([...room.simProgress.trailingPlayers],["a"]);
 assert.equal(analyzeFinalOutcome(room,"b").comebackWin,false,"losing despite deficit is not a comeback");
 assert.equal(analyzeFinalOutcome(room,"a").comebackWin,true,"trailing winner is a comeback");
 a.lastStandUsed=true;
 assert.equal(analyzeFinalOutcome(room,"a").comebackUserWin,true,"ability use is tracked separately");
});
test("comeback indicator is not triggered by small or irrelevant fluctuations",()=>{
 const room=make(),a=room.players[0];a.hp=20;room.players[1].hp=25;
 room.players[1].field.length=2;
 assert.equal(isSeverelyBehind(room,a),false);
 a.hp=22;room.players[1].field.length=5;
 assert.equal(isSeverelyBehind(room,a),false,"field-only lead cannot trigger unless hp gap >=3");
 a.hp=20;room.players[1].field.length=5;
 assert.equal(isSeverelyBehind(room,a),true,"combined hp+field deficit qualifies");
});
