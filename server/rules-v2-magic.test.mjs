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
