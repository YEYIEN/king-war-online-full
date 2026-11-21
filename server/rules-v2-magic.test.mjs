import {kingAttackV2} from './rules-v2-turn.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {MAGIC_DEFS,magicComposition,drawMagicV2,castMagicV2,tickMagicTurnV2} from './rules-v2-magic.mjs';
const unit=(type='法師',rank='高級')=>({type,rank,tapped:false,justDeployed:false,status:[]});
const player=(magic)=>({king:'秦始皇',hp:24,hand:[],magic:[magic],field:[unit()]});
test('magic deck has all nine spells and correct counts',()=>{const d=magicComposition();assert.equal(d.length,16);for(const m of MAGIC_DEFS)assert.equal(d.filter(x=>x.name===m.name).length,m.count)});
test('magic draw requires field mages and respects capacity',()=>{const p=player(null);p.magic=[];const r=drawMagicV2(p,magicComposition(),[]);assert.equal(r.player.magic.length,1);assert.equal(r.deck.length,15)});
test('fireball kills junior target and consumes caster action',()=>{const a=player({name:'火球術'}),b={hp:24,field:[unit('步兵','初級')]};const r=castMagicV2(a,b,0,0,[0]);assert.equal(r.opponent.field.length,0);assert.equal(r.caster.magic.length,0);assert.equal(r.caster.field[0].tapped,true)});
test('invalid mage, target and spell do not mutate inputs',()=>{const a=player({name:'火球術'}),b={hp:24,field:[unit('步兵','初級')]};const before=JSON.stringify([a,b]);assert.throws(()=>castMagicV2(a,b,0,1,[0]));assert.throws(()=>castMagicV2(a,b,0,0,[99]));assert.equal(JSON.stringify([a,b]),before)});
test('poison removes target at turn end',()=>{const a=player({name:'毒藥瓶'}),b={hp:24,field:[unit('步兵','中級')]};const r=castMagicV2(a,b,0,0,[0]);assert.equal(tickMagicTurnV2(r.opponent,'end').field.length,0)});
test('freeze cannot stack',()=>{const a=player({name:'冰凍術'}),b={hp:24,field:[unit('步兵','初級')]};b.field[0].status.push('冰凍');assert.throws(()=>castMagicV2(a,b,0,0,[0]))});

test('meteor targets up to three units and removes juniors',()=>{const a=player({name:'流星雨'}),b={hp:24,field:[unit('步兵','初級'),unit('騎兵','中級'),unit('弓兵','高級')]};const r=castMagicV2(a,b,0,0,[0,1,2]);assert.equal(r.opponent.field.length,2);assert.equal(r.opponent.field[0].modifier,-1);assert.equal(r.opponent.field[1].modifier,-1)});
test('meteor and apocalypse reject inappropriate targets',()=>{const a=player({name:'天殞術'}),b={hp:24,field:[unit('步兵','初級'),unit('弓兵','高級')]};assert.throws(()=>castMagicV2(a,b,0,0,[0]));const r=castMagicV2(a,b,0,0,[]);assert.equal(r.opponent.field.length,1);assert.ok(r.opponent.field[0].status.includes('冰凍'))});
test('blood magic spends HP and resets own unit',()=>{const a=player({name:'燃血術'});a.field.push(unit('步兵','中級'));a.field[1].tapped=true;const r=castMagicV2(a,{hp:24,field:[]},0,0,[1]);assert.equal(r.caster.hp,21);assert.equal(r.caster.field[1].tapped,false);assert.ok(r.caster.field[1].status.includes('燃血傷害'))});

test('frozen unit cannot act on next turn and recovers afterward',()=>{const p={field:[{...unit('步兵','中級'),status:['冰凍']}]};const x=tickMagicTurnV2(p,'start');assert.equal(x.field[0].tapped,true);assert.equal(x.field[0].status.includes('冰凍'),false);assert.equal(tickMagicTurnV2(x,'start').field[0].tapped,false)});
test('self-targeted blood magic retains caster identity',()=>{const a=player({name:'燃血術'});const x=castMagicV2(a,{hp:24,field:[]},0,0,[0]);assert.equal(x.caster.field[0].tapped,true);assert.equal(x.caster.hp,21)});
test('magic caster is still tapped when earlier target index is removed',()=>{const a=player({name:'火球術'});const b={hp:24,field:[unit('步兵','初級')]};const x=castMagicV2(a,b,0,0,[0]);assert.equal(x.caster.field[0].tapped,true)});

test('blood power modifier expires at end of casting turn',()=>{const a=player({name:'燃血術'});a.field.push(unit('步兵','中級'));const x=castMagicV2(a,{hp:24,field:[]},0,0,[1]);assert.equal(x.caster.field[1].modifier,1);const y=tickMagicTurnV2(x.caster,'end');assert.equal(y.field[1].modifier,0);assert.equal(y.field[1].status.includes('燃血傷害'),false)});

test('every one of nine magic definitions resolves with legal caster and target',()=>{
 for(const def of MAGIC_DEFS){
  const a=player({name:def.name}),b={hp:24,field:[unit('步兵','中級'),unit('騎兵','高級')]};
  a.field.push(unit('步兵','中級'));
  const indices=def.maxTargets===0?[]:[0];
  const x=castMagicV2(a,b,0,0,indices);
  assert.equal(x.caster.magic.length,0,def.name);
  assert.equal(x.discarded.name,def.name);
 }
});
test('magic draw respects three-card hand cap and one draw per mage',()=>{
 const p=player(null);p.magic=[{name:'火球術'},{name:'力量術'}];p.field.push(unit());
 const r=drawMagicV2(p,magicComposition(),[]);
 assert.equal(r.player.magic.length,3);
 assert.equal(r.deck.length,15);
});

test('ice rank penalty on high-level unit expires at owner turn start',()=>{const a=player({name:'冰凍術'}),b={hp:24,field:[unit('步兵','高級')]};const x=castMagicV2(a,b,0,0,[0]);assert.equal(x.opponent.field[0].modifier,-1);const y=tickMagicTurnV2(x.opponent,'start');assert.equal(y.field[0].modifier,0)});

test('stacked strength and enhancement effects expire without permanent power',()=>{
 const unitA=unit('步兵','中級');unitA.modifier=2;unitA.status=['力量術','力量術'];
 const end=tickMagicTurnV2({field:[unitA]},'end');
 assert.equal(end.field[0].modifier,0);
 const unitB=unit('步兵','中級');unitB.modifier=2;unitB.status=['增強術','增強術'];
 const start=tickMagicTurnV2({field:[unitB]},'start');
 assert.equal(start.field[0].modifier,0);
});

test('fireball, meteor and weakness penalties expire on target owner turn',()=>{
 for(const name of ['火球術','流星雨','虛弱術']){
  const a=player({name}),b={hp:24,field:[unit('步兵','高級')]};
  const x=castMagicV2(a,b,0,0,[0]);
  assert.equal(x.opponent.field[0].modifier,-1,name);
  assert.equal(tickMagicTurnV2(x.opponent,'start').field[0].modifier,0,name);
 }
});

test('weakness reduces rank-one power and prevents next owner attack',()=>{
 const a=player({name:'虛弱術'}),b={hp:24,field:[unit('步兵','初級')]};
 const x=castMagicV2(a,b,0,0,[0]);
 assert.equal(x.opponent.field[0].modifier,-1);
 assert.ok(x.opponent.field[0].status.includes('虛弱禁攻'));
 const next=tickMagicTurnV2(x.opponent,'start');
 assert.equal(next.field[0].tapped,true);
 assert.equal(next.field[0].modifier,0);
});
test('blood magic cannot kill its own caster king',()=>{
 const a=player({name:'燃血術'});a.hp=3;
 assert.throws(()=>castMagicV2(a,{hp:24,field:[]},0,0,[0]),/Insufficient HP/);
});
test('recycled magic discard becomes a fresh draw deck',()=>{
 const a=player(null);a.magic=[];
 const x=drawMagicV2(a,[],[{name:'力量術',id:'recycled'}]);
 assert.equal(x.player.magic[0].id,'recycled');
 assert.equal(x.discard.length,0);
});

test('multiple blood buffs expire without leftover power',()=>{
 const a=player({name:'燃血術'});a.field.push(unit('步兵','中級'));
 const first=castMagicV2(a,{hp:24,field:[]},0,0,[1]);
 const boosted=first.caster.field[1];
 boosted.modifier+=1;boosted.status.push('燃血傷害');
 const done=tickMagicTurnV2(first.caster,'end');
 assert.equal(done.field[1].modifier,0);
 assert.equal(done.field[1].status.includes('燃血傷害'),false);
});

test('enhancement and blood magic each increase king damage once',()=>{
 for(const spell of ['增強術','燃血術']){
  const a=player({name:spell}),b={hp:24,field:[]};
  const cast=castMagicV2(a,b,0,0,[0]);
  const ready={...cast.caster,field:cast.caster.field.map(u=>({...u,tapped:false}))};
  const attack=kingAttackV2(ready,b,0);
  assert.equal(attack.damage,6,spell);
  assert.equal(attack.defender.hp,18);
 }
});
