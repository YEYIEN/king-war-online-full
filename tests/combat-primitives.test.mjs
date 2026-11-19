import test from "node:test";
import assert from "node:assert/strict";
import {rankValue,power,effectiveDamage,canAttack,battle,previewUnitAttack} from "../server/combat-primitives.js";

const types=["步兵","弓兵","法師","騎兵"];
const ranks=["初級","中級","高級"];
const counters={步兵:"弓兵",弓兵:"法師",法師:"騎兵",騎兵:"步兵"};
const make=(type,rank,status=[])=>({
 id:`${type}-${rank}`,type,rank,counterTarget:counters[type],
 damage:rankValue(rank)===1?1:rankValue(rank)===2?3:5,
 tapped:false,archerBonusUsed:false,status:[...status]
});

test("all 144 type-and-rank pairs have deterministic non-mutating previews",()=>{
 for(const type of types)for(const rank of ranks)for(const enemyType of types)for(const enemyRank of ranks){
  const a=make(type,rank),d=make(enemyType,enemyRank);
  const before=JSON.stringify([a,d]);
  const forecast=previewUnitAttack(a,d);
  assert.equal(forecast.verdict,battle(a,d));
  assert.equal(forecast.killedEnemy,["attacker","both"].includes(forecast.verdict));
  assert.equal(forecast.killedAttacker,(["defender","both"].includes(forecast.verdict))&&!forecast.archerSaved);
  assert.equal(JSON.stringify([a,d]),before);
  assert.deepEqual(previewUnitAttack(a,d),forecast);
 }
});

test("archer survivability, extra strike, and status-derived power are respected",()=>{
 const highArcher=make("弓兵","高級");
 const lowInfantry=make("步兵","初級");
 const weak=previewUnitAttack(highArcher,lowInfantry);
 assert.equal(weak.archerExtra,true);
 highArcher.archerBonusUsed=true;
 assert.equal(previewUnitAttack(highArcher,lowInfantry).archerExtra,false);
 const weakerArcher=make("弓兵","初級");
 const hardEnemy=make("騎兵","高級");
 assert.equal(previewUnitAttack(weakerArcher,hardEnemy).archerSaved,true);
 assert.equal(power(make("法師","初級",["階級-1"])),1);
 assert.equal(power(make("騎兵","中級",["整備"])),1);
 assert.equal(power(make("騎兵","中級",["階級+1"])),3);
 assert.equal(effectiveDamage(make("法師","中級",["傷害+1","燃血+1傷害"])),5);
 assert.equal(canAttack(make("法師","中級",["疲乏待解"])),false);
 assert.equal(canAttack(make("騎兵","中級")),true);
});

test("type advantage is temporary and determines archer tie survival",()=>{
 const archer=make("弓兵","中級");
 const mage=make("法師","高級");
 const p=previewUnitAttack(archer,mage);
 assert.equal(p.attackerPower,3);
 assert.equal(p.defenderPower,3);
 assert.equal(p.verdict,"both");
 assert.equal(p.killedEnemy,true);
 assert.equal(p.killedAttacker,false);
 assert.equal(p.archerExtra,false);
 assert.equal(power(archer),2);
});
test("archer loses without dying, and successful archer gets only one extra attack",()=>{
 const archer=make("弓兵","初級");
 const strong=make("騎兵","高級");
 const loss=previewUnitAttack(archer,strong);
 assert.equal(loss.verdict,"defender");
 assert.equal(loss.killedAttacker,false);
 assert.equal(loss.killedEnemy,false);
 const strongArcher=make("弓兵","高級");
 const weak=make("法師","初級");
 assert.equal(previewUnitAttack(strongArcher,weak).archerExtra,true);
 strongArcher.archerBonusUsed=true;
 assert.equal(previewUnitAttack(strongArcher,weak).archerExtra,false);
});
test("archer passive never protects an archer who is defending",()=>{
 const attacker=make("步兵","高級");
 const defendingArcher=make("弓兵","初級");
 const p=previewUnitAttack(attacker,defendingArcher);
 assert.equal(p.verdict,"attacker");
 assert.equal(p.killedEnemy,true);
});
test("half recovery and high recovery reduce power without allowing high-recovery attack",()=>{
 const defender=make("騎兵","高級",["半整備"]);
 assert.equal(power(defender),2);
 assert.equal(canAttack(defender),true);
 const archer=make("弓兵","中級",["高整備"]);
 assert.equal(power(archer),1);
 assert.equal(canAttack(archer),false);
 assert.equal(power(make("步兵","初級",["半整備"])),0);
});
