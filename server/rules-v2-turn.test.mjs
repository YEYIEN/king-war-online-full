import test from 'node:test';import assert from 'node:assert/strict';import {startV2Turn,deployV2,battleV2,kingAttackV2,interceptV2,louisV2,genghisV2,endV2Turn,newV2Player} from './rules-v2-turn.mjs';
import {tickMagicTurnV2} from './rules-v2-magic.mjs';
const u=(type,rank,extra={})=>({type,rank,...extra});
test('turn-start eligibility and no immediate deploy attack',()=>{let p=startV2Turn({...newV2Player('路易十四'),hand:[u('弓兵','初級')]},1);p=deployV2(p,0);assert.throws(()=>kingAttackV2(p,newV2Player('秦始皇'),0));assert.throws(()=>louisV2(p,0));p=startV2Turn(p,2);assert.equal(louisV2({...p,hp:15},0).hp,18)});
test('king guard and direct damage',()=>{const a=startV2Turn({...newV2Player('亞歷山大大帝'),field:[u('騎兵','高級')]},1),d={...newV2Player('秦始皇'),field:[u('步兵','初級')]};assert.throws(()=>kingAttackV2(a,d,0));const r=kingAttackV2(a,{...d,field:[]},0);assert.equal(r.defender.hp,19);assert.equal(r.attacker.field[0].tapped,true)});
test('Augustus survives tie and Alexander consumes ability',()=>{const a=startV2Turn({...newV2Player('亞歷山大大帝'),field:[u('步兵','中級')]},1),d={...newV2Player('屋大維奧古斯都'),field:[u('步兵','高級')]};const r=battleV2(a,d,0,0,{alexander:true});assert.equal(r.defender.field.length,1);assert.equal(r.attacker.field.length,0);assert.equal(r.attacker.abilityUsed,true)});
test('Genghis swap does not create obsolete magic-hand requirements',()=>{const p=startV2Turn({...newV2Player('成吉思汗'),field:[u('法師','高級')],hand:[u('弓兵','初級')]},1);const r=genghisV2(p,0,0);assert.equal(r.abilityUsed,true);assert.equal(r.field[0].type,'弓兵');assert.equal('magicOverLimit' in r,false)});
test('Qin draws three, returns one of newly drawn cards, net plus two',()=>{const p={...newV2Player('秦始皇'),hand:['a','b']};const r=endV2Turn(p,['c','d','e','f'],[],{qinBottomIndex:1});assert.deepEqual(r.player.hand,['a','b','c','e']);assert.deepEqual(r.unitDeck,['f','d']);});
test('normal end turn draws exactly two without voluntary discard',()=>{const p={...newV2Player('亞歷山大大帝'),hand:['a','b','c']};const r=endV2Turn(p,['d','e'],[]);assert.deepEqual(r.player.hand,['a','b','c','d','e']);assert.deepEqual(r.unitDiscard,[])});test('five-card cap requires explicit overflow selection',()=>{const p={...newV2Player('亞歷山大大帝'),hand:['a','b','c','d']};assert.throws(()=>endV2Turn(p,['e','f'],[]),/Select exactly 1/);const r=endV2Turn(p,['e','f'],[],{overflowDiscardIndices:[1]});assert.deepEqual(r.player.hand,['a','c','d','e','f']);assert.deepEqual(r.unitDiscard,['b'])});test('Qin at hand limit chooses drawn card and discards two excess',()=>{const p={...newV2Player('秦始皇'),hand:['a','b','c','d','e']};const r=endV2Turn(p,['f','g','h'],[],{qinBottomIndex:1,overflowDiscardIndices:[0,1]});assert.deepEqual(r.player.hand,['c','d','e','f','h']);assert.deepEqual(r.unitDeck,['g'])});

test('half-ready defense penalty lasts until owner next turn, then expires',()=>{
 const attacker=startV2Turn({...newV2Player('亞歷山大大帝'),field:[u('步兵','初級')]},1);
 const defender={...newV2Player('秦始皇'),field:[u('步兵','中級')]};
 const result=battleV2(attacker,defender,0,0);
 assert.equal(result.defender.field[0].modifier,-1);
 assert.equal(result.defender.field[0].halfReadyUntilOwnerTurn,true);
 const next=startV2Turn(result.defender,2);
 assert.equal(next.field[0].modifier,-1);
 assert.equal(next.field[0].halfReadyUntilOwnerTurn,true);
 const ended=tickMagicTurnV2(next,'end');
 assert.equal(ended.field[0].modifier,0);
 assert.equal(ended.field[0].halfReadyUntilOwnerTurn,false);
});

test('malformed indices and discard payloads are rejected',()=>{
 const p=newV2Player('亞歷山大大帝');
 p.hand=[{type:'步兵',rank:'初級'}];
 assert.throws(()=>deployV2(p,undefined));
 assert.throws(()=>deployV2(p,0.5));
 assert.throws(()=>endV2Turn(p,['a','b'],[],{overflowDiscardIndices:null}));
 assert.throws(()=>endV2Turn(p,['a','b'],[],{overflowDiscardIndices:['0']}));
});

test('half-ready recovery preserves independent magic modifiers',()=>{
 const p={...newV2Player('秦始皇'),field:[u('步兵','高級',{modifier:1,halfReadyUntilOwnerTurn:true,status:['力量術']})]};
 const next=startV2Turn(p,3);
 assert.equal(next.field[0].modifier,1,'half-ready penalty remains during owner turn');
 assert.equal(next.field[0].halfReadyUntilOwnerTurn,true);
 assert.equal(tickMagicTurnV2(next,'end').field[0].modifier,2,'recover after turn, preserve strength');
});

test('interception succeeds on tie, discards card and kills attacker',()=>{const a=startV2Turn({...newV2Player('亞歷山大大帝'),field:[u('弓兵','中級')]},1);const d={...newV2Player('秦始皇'),hand:[u('步兵','初級')]};const x=interceptV2(a,d,0,0,'player1');assert.equal(x.success,true);assert.equal(x.damage,0);assert.equal(x.attacker.field.length,0);assert.equal(x.defender.hand.length,0);assert.equal(x.defender.interceptionUsedBy.player1,true);assert.throws(()=>interceptV2(startV2Turn({...newV2Player('亞歷山大大帝'),field:[u('弓兵','初級')]},2),{...x.defender,hand:[u('步兵','初級')]},0,0,'player1'));});
test('failed interception reduces direct king damage by one',()=>{const a=startV2Turn({...newV2Player('亞歷山大大帝'),field:[u('弓兵','高級')]},1);const d={...newV2Player('秦始皇'),hand:[u('法師','初級')]};const x=interceptV2(a,d,0,0,'player1');assert.equal(x.success,false);assert.equal(x.damage,4);assert.equal(x.defender.hp,20);assert.equal(x.attacker.field.length,1);assert.equal(x.attacker.field[0].tapped,true);});
test('half-ready cannot stack after repeated successful defenses',()=>{let d={...newV2Player('秦始皇'),field:[u('步兵','高級')]};for(let i=0;i<2;i++){const a=startV2Turn({...newV2Player('亞歷山大大帝'),field:[u('步兵','初級')]},i+1);d=battleV2(a,d,0,0).defender;}assert.equal(d.field[0].modifier,-1);const active=startV2Turn(d,3);assert.equal(active.field[0].modifier,-1);assert.equal(tickMagicTurnV2(active,'end').field[0].modifier,0);});

test('interception is per attacking player and resets on defender turn',()=>{const attack=()=>startV2Turn({...newV2Player('亞歷山大大帝'),field:[u('弓兵','初級')]},1);const d={...newV2Player('秦始皇'),hand:[u('步兵','初級'),u('步兵','初級'),u('步兵','初級')]};const first=interceptV2(attack(),d,0,0,'player1');assert.throws(()=>interceptV2(attack(),first.defender,0,0,'player1'),/already used/);const third=interceptV2(attack(),first.defender,0,0,'player3');assert.equal(third.defender.interceptionUsedBy.player3,true);const reset=startV2Turn(third.defender,2);assert.deepEqual(reset.interceptionUsedBy,{});});

test('next-battle strength bonus is consumed after battle, not at turn end',()=>{
 const a=startV2Turn({...newV2Player('亞歷山大大帝'),field:[u('步兵','初級',{id:'buffed',modifier:1,status:['力量術']})]},3);
 const d={...newV2Player('秦始皇'),field:[u('步兵','初級',{id:'enemy'})]};
 const result=battleV2(a,d,0,0);
 assert.equal(result.result.attack,2);
 assert.equal(result.attacker.field[0].modifier,0);
 assert.equal(result.attacker.field[0].status.includes('力量術'),false);
});
test('next-battle blood bonus is consumed after battle',()=>{
 const a=startV2Turn({...newV2Player('亞歷山大大帝'),field:[u('步兵','初級',{id:'blood',modifier:2,status:['燃血術']})]},3);
 const d={...newV2Player('秦始皇'),field:[u('步兵','初級',{id:'enemy'})]};
 const result=battleV2(a,d,0,0);
 assert.equal(result.result.attack,3);
 assert.equal(result.attacker.field[0].modifier,0);
 assert.equal(result.attacker.field[0].status.includes('燃血術'),false);
});
