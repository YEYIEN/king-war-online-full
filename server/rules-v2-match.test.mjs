import test from 'node:test';
import assert from 'node:assert/strict';
import {newV2Player,startV2Turn,deployV2,kingAttackV2,endV2Turn} from './rules-v2-turn.mjs';
const card=(id)=>({id,type:'弓兵',rank:'高級'});
test('two-player deterministic end-to-end match: draw, deploy, turn, damage, victory',()=>{
  let players=[newV2Player('亞歷山大大帝'),newV2Player('屋大維奧古斯都')];
  let deck=Array.from({length:18},(_,i)=>card(i));
  let discard=[];
  for(let i=0;i<2;i++){players[i]={...players[i],hand:deck.splice(0,3)}}
  let current=0,turn=1,finished=false,winner=null,attacks=0;
  players[0]=startV2Turn(players[0],turn);
  for(let step=0;step<40&&!finished;step++){
    let p=players[current],other=players[1-current];
    if(!p.field.length&&p.hand.length)p=deployV2(p,0);
    const active=p.field.findIndex(u=>!u.tapped&&!u.justDeployed);
    if(active>=0){
      const outcome=kingAttackV2(p,other,active);
      p=outcome.attacker;other=outcome.defender;attacks++;
      if(outcome.eliminated){finished=true;winner=current;}
    }
    players[current]=p;players[1-current]=other;
    if(finished)break;
    const count=Math.min(2,deck.length+discard.length);const excess=Math.max(0,p.hand.length+count-5);const x=endV2Turn(p,deck,discard,{overflowDiscardIndices:Array.from({length:excess},(_,i)=>i)});
    players[current]=x.player;deck=x.unitDeck;discard=x.unitDiscard;
    current=1-current;turn++;
    players[current]=startV2Turn(players[current],turn);
  }
  assert.equal(finished,true,'match must finish');
  assert.equal(winner,0,'first seat should win under identical high-archer conditions');
  assert.equal(players[1].hp,0);
  assert.equal(attacks,9,'five first-seat and four second-seat hits');
  assert.equal(players[0].hp,4);
});
