import test from 'node:test';import assert from 'node:assert/strict';import {startV2Turn,deployV2,battleV2,kingAttackV2,louisV2,genghisV2,discardExcessMagicV2,endV2Turn,newV2Player} from './rules-v2-turn.mjs';
const u=(type,rank,extra={})=>({type,rank,...extra});
test('turn-start eligibility and no immediate deploy attack',()=>{let p=startV2Turn({...newV2Player('路易十四'),hand:[u('弓兵','初級')]},1);p=deployV2(p,0);assert.throws(()=>kingAttackV2(p,newV2Player('秦始皇'),0));assert.throws(()=>louisV2(p,0));p=startV2Turn(p,2);assert.equal(louisV2({...p,hp:15},0).hp,18)});
test('king guard and direct damage',()=>{const a=startV2Turn({...newV2Player('亞歷山大大帝'),field:[u('騎兵','高級')]},1),d={...newV2Player('秦始皇'),field:[u('步兵','初級')]};assert.throws(()=>kingAttackV2(a,d,0));const r=kingAttackV2(a,{...d,field:[]},0);assert.equal(r.defender.hp,19);assert.equal(r.attacker.field[0].tapped,true)});
test('Augustus survives tie and Alexander consumes ability',()=>{const a=startV2Turn({...newV2Player('亞歷山大大帝'),field:[u('步兵','中級')]},1),d={...newV2Player('屋大維奧古斯都'),field:[u('步兵','高級')]};const r=battleV2(a,d,0,0,{alexander:true});assert.equal(r.defender.field.length,1);assert.equal(r.attacker.field.length,0);assert.equal(r.attacker.abilityUsed,true)});
test('Genghis swap forces magic discard',()=>{const p=startV2Turn({...newV2Player('成吉思汗'),field:[u('法師','高級')],hand:[u('弓兵','初級')],magic:['x']},1);const r=genghisV2(p,0,0);assert.equal(r.magicOverLimit,1);assert.deepEqual(discardExcessMagicV2(r,[0]).player.magic,[])});
test('Qin end-turn selection',()=>{const p={...newV2Player('秦始皇'),hand:['a','b']};const r=endV2Turn(p,['c','d','e'],[],[],1);assert.deepEqual(r.player.hand,['a','c','d']);assert.deepEqual(r.unitDeck,['e','b']);});
test('regular end-turn hand refill and discard',()=>{const p={...newV2Player('亞歷山大大帝'),hand:['a','b','c']};const r=endV2Turn(p,['d','e'],[],[1]);assert.deepEqual(r.player.hand,['a','c','d']);assert.deepEqual(r.unitDiscard,['b'])});

test('half-ready defense penalty lasts until owner next turn, then expires',()=>{
 const attacker=startV2Turn({...newV2Player('亞歷山大大帝'),field:[u('步兵','初級')]},1);
 const defender={...newV2Player('秦始皇'),field:[u('步兵','中級')]};
 const result=battleV2(attacker,defender,0,0);
 assert.equal(result.defender.field[0].modifier,-1);
 assert.equal(result.defender.field[0].halfReadyUntilOwnerTurn,true);
 const next=startV2Turn(result.defender,2);
 assert.equal(next.field[0].modifier,0);
 assert.equal(next.field[0].halfReadyUntilOwnerTurn,false);
});
