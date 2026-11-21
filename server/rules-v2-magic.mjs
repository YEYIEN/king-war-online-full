export const MAGIC_DEFS=[
{name:'火球術',count:2,level:1,target:'enemy',maxTargets:1},
{name:'冰凍術',count:2,level:1,target:'enemy',maxTargets:1},
{name:'力量術',count:3,level:1,target:'self',maxTargets:1},
{name:'虛弱術',count:2,level:2,target:'enemy',maxTargets:1},
{name:'增強術',count:2,level:2,target:'self',maxTargets:1},
{name:'流星雨',count:1,level:2,target:'enemy',maxTargets:0},
{name:'毒藥瓶',count:1,level:3,target:'enemy',maxTargets:1},
{name:'燃血術',count:1,level:3,target:'self',maxTargets:1},
{name:'天殞術',count:1,level:3,target:'enemy',maxTargets:1}
];
export function magicComposition(){return MAGIC_DEFS.flatMap(d=>Array.from({length:d.count},()=>({...d})));}
export function castMagicV2(caster,opponent,magicIndex,mageIndex,targetIndices=[]){
 const a={...caster,field:caster.field.map(u=>({...u,status:[...(u.status||[])]})),magic:[...caster.magic]},b={...opponent,field:opponent.field.map(u=>({...u,status:[...(u.status||[])]}))};
 const magic=typeof magicIndex==='string'?magicIndex:MAGIC_DEFS[magicIndex]?.name,def=MAGIC_DEFS.find(x=>x.name===magic);
 if(!def)throw Error('Unknown magic');if(a.magicCastThisTurn)throw Error('Only one magic per turn');
 const mage=a.field[mageIndex];if(!Number.isInteger(mageIndex)||!mage||mage.type!=='法師'||mage.tapped||({初級:1,中級:2,高級:3}[mage.rank]<def.level))throw Error('Mage cannot cast');
 if(!Array.isArray(targetIndices)||new Set(targetIndices).size!==targetIndices.length||targetIndices.some(i=>!Number.isInteger(i)||i<0))throw Error('Invalid targets');
 const field=def.target==='self'?a.field:b.field;
 if(def.maxTargets===0){if(targetIndices.length)throw Error('No targets allowed');}
 else if(targetIndices.length<1||targetIndices.length>def.maxTargets||targetIndices.some(i=>i>=field.length))throw Error('Invalid target count');
 if(magic==='冰凍術'&&targetIndices.some(i=>field[i].status.includes('冰凍')))throw Error('Freeze cannot stack');
 if(magic==='燃血術'&&a.hp<=3)throw Error('Insufficient HP');
 const castingMageId=mage.id;const dead=new Set();const add=(u,status)=>{if(!u.status.includes(status))u.status.push(status)};
 for(const i of targetIndices){const u=field[i];switch(magic){
 case '火球術':if(u.rank==='初級')dead.add(i);else if(!u.halfReadyUntilOwnerTurn){u.modifier=(u.modifier||0)-1;u.halfReadyUntilOwnerTurn=true}break;
 case '冰凍術':add(u,'冰凍');break;
 case '力量術':u.modifier=(u.modifier||0)+1;add(u,'力量術');break;
 case '虛弱術':if(!u.status.includes('虛弱降戰力')){u.modifier=(u.modifier||0)-1;add(u,'虛弱降戰力')}break;
 case '增強術':if(!u.status.includes('增強術')){u.modifier=(u.modifier||0)+1;add(u,'增強術')}break;
 case '毒藥瓶':add(u,'下回合死亡');break;
 case '燃血術':if(u.tapped||u.justDeployed)throw Error('Target already acted');a.hp-=3;u.modifier=(u.modifier||0)+2;add(u,'燃血術');break;
 }}
 if(magic==='流星雨')b.field.forEach((u,i)=>{if(u.rank==='初級')dead.add(i)});if(magic==='天殞術')dead.add(targetIndices[0]);
 field.splice(0,field.length,...field.filter((_,i)=>!dead.has(i)));
 const survivingMage=a.field.find(u=>u===mage||(castingMageId!==undefined&&u.id===castingMageId));if(survivingMage)survivingMage.tapped=true;
 a.magicCastThisTurn=true;
 return {caster:a,opponent:b,spell:{name:magic,level:def.level}};
}
export function tickMagicTurnV2(player,phase){const p={...player,field:player.field.map(u=>({...u,status:[...(u.status||[])]}))};if(phase==='start')p.field.forEach(u=>{for(const debuff of ['虛弱降戰力'])if(u.status.includes(debuff)){u.modifier=(u.modifier||0)+u.status.filter(x=>x===debuff).length;u.status=u.status.filter(x=>x!==debuff)}u.tapped=u.status.includes('冰凍');u.status=u.status.filter(x=>x!=='冰凍');for(const s of ['增強術'])if(u.status.includes(s)){const count=u.status.filter(x=>x===s).length;u.status=u.status.filter(x=>x!==s);if(s==='增強術')u.modifier=(u.modifier||0)-count}});if(phase==='end'){p.field=p.field.filter(u=>!u.status.includes('下回合死亡'));p.field.forEach(u=>{for(const buff of ['力量術','燃血術'])if(u.status.includes(buff)){const count=u.status.filter(x=>x===buff).length;u.modifier=(u.modifier||0)-count*(buff==='燃血術'?2:1);u.status=u.status.filter(x=>x!==buff)}})}return p;}
