// Standalone V2 primitives; not wired to Socket.IO yet.
export const KING_MAX_HP=24, UNIT_HAND_LIMIT=3, FIELD_LIMIT=3;
export const COUNTER={步兵:'弓兵',弓兵:'法師',法師:'騎兵',騎兵:'步兵'};
export const POWER={初級:1,中級:2,高級:3};
export const KING_DAMAGE={初級:1,中級:3,高級:5};
export function unitComposition(){return ['步兵','弓兵','法師','騎兵'].flatMap(type=>Object.entries({初級:7,中級:5,高級:3}).flatMap(([rank,count])=>Array.from({length:count},()=>({type,rank}))));}
export function effectivePower(unit,opponent,bonus=0){return Math.max(0,POWER[unit.rank]+(COUNTER[unit.type]===opponent.type?1:0)+(unit.modifier||0)+bonus);}
export function resolveBattle(attacker,defender,{alexander=false,augustus=false}={}){const attack=effectivePower(attacker,defender,alexander?1:0),defense=effectivePower(defender,attacker);if(attack>defense)return {attack,defense,attackerDies:false,defenderDies:true,defenderHalfReady:false};if(attack===defense)return {attack,defense,attackerDies:true,defenderDies:!augustus,defenderHalfReady:augustus};return {attack,defense,attackerDies:true,defenderDies:false,defenderHalfReady:true};}
export function canAttackKing(attacker,defenderField){return attacker.type==='弓兵'||!defenderField.some(u=>u.type==='步兵');}
export function canSacrificeLouis(unit,turn){return unit.turnStartPresent===turn;}
export function sacrificeLouis(kingHp,unit,turn){if(!canSacrificeLouis(unit,turn))throw Error('Unit not present at turn start');return Math.min(unit.kingMaxHp||KING_MAX_HP,kingHp+3);}
export function magicCapacity(field){return field.filter(u=>u.type==='法師').length;}
export function exchangeGenghis(field,hand,fieldIndex,handIndex){if(!Number.isInteger(fieldIndex)||!Number.isInteger(handIndex)||fieldIndex<0||fieldIndex>=field.length||handIndex<0||handIndex>=hand.length)throw Error('Invalid exchange');const f=[...field],h=[...hand],out=f[fieldIndex],incoming=h[handIndex];f[fieldIndex]={...incoming,status:[],modifier:0,justDeployed:true,tapped:true,turnStartPresent:null};h[handIndex]={...out,status:[],modifier:0,turnStartPresent:null};return {field:f,hand:h,magicLimit:magicCapacity(f)};}
export function qinSelect(cards,selectedIndex){if(cards.length!==4||!Number.isInteger(selectedIndex)||selectedIndex<0||selectedIndex>3)throw Error('Qin needs four choices');return {hand:cards.filter((_,i)=>i!==selectedIndex),deckBottom:cards[selectedIndex]};}
