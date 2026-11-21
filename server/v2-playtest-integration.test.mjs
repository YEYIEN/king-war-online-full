import test from 'node:test';
import assert from 'node:assert/strict';
import {registerV2Playtest} from './v2-playtest-socket.mjs';

function harness(count){
 const connections=[],states=new Map();
 const nsp={
  on(event,fn){if(event==='connection')this.connect=fn},
  to(id){return {emit(event,data){if(event==='v2:state')states.set(id,data)}}}
 };
 registerV2Playtest({of(){return nsp}},{deckOrder:cards=>cards.sort((a,b)=>({高級:0,中級:1,初級:2}[a.rank]-{高級:0,中級:1,初級:2}[b.rank]))});
 for(let i=0;i<count;i++){
  const handlers={};
  const socket={id:'p'+i,on(e,fn){handlers[e]=fn},join(){}};
  nsp.connect(socket);
  connections.push({id:socket.id,call(event,data={}){let answer;handlers[event](data,r=>{answer=r});assert.ok(answer,'missing ack '+event);return answer},disconnect(){handlers.disconnect()}});
 }
 const ok=(i,event,data)=>{const r=connections[i].call(event,data);assert.equal(r.ok,true,event+': '+r.error);return r};
 const created=ok(0,'v2:create',{name:'Player 0',king:'亞歷山大大帝'}),code=created.code;
 for(let i=1;i<count;i++)ok(i,'v2:join',{code,name:'Player '+i,king:'路易十四'});
 ok(0,'v2:start',{code});
 return {ok,code,connections,states,view:i=>states.get('p'+i)};
}

for(const count of [2,3,4,5]){
 test(count+' player room: hidden hands, legal target, rotating turns and completed winner',()=>{
  const h=harness(count),{ok,code,view}=h;
  assert.equal(view(0).players.length,count);
  for(let i=0;i<count;i++){
   assert.equal(view(i).players[i].hand.length,5);
   for(let j=0;j<count;j++)if(i!==j)assert.equal(view(i).players[j].hand,undefined);
  }
  const bad=h.connections[0].call('v2:attack',{code,attackerIndex:0,defenderPlayerIndex:0});
  assert.equal(bad.ok,false,'cannot attack yourself');
  // Player zero deploys once, then repeatedly attacks surviving kings.
  ok(0,'v2:deploy',{code,index:0});
  let guard=0;
  while(view(0).status==='playing'&&guard++<160){
   const v=view(0),cur=v.current;
   if(cur===0){
    const attacker=v.players[0].field.findIndex(u=>!u.tapped&&!u.justDeployed);
    const target=v.players.findIndex((p,i)=>i!==0&&p.hp>0);
    if(attacker>=0&&target>=0){
     ok(0,'v2:attack',{code,attackerIndex:attacker,defenderPlayerIndex:target});
     ok(target,'v2:respond-attack',{code,handIndex:null});
    }
    if(view(0).status==='finished')break;
    // Keep at most five cards, choose overflow explicitly.
    const me=view(0).players[0];
    const excess=Math.max(0,me.hand.length+2-5);
    ok(0,'v2:end',{code,overflowDiscardIndices:Array.from({length:excess},(_,i)=>i)});
   }else{
    const me=view(cur).players[cur];
    const excess=Math.max(0,me.hand.length+2-5);
    ok(cur,'v2:end',{code,overflowDiscardIndices:Array.from({length:excess},(_,i)=>i)});
   }
  }
  assert.equal(view(0).status,'finished','simulation did not reach winner');
  assert.equal(view(0).winner,'Player 0');
 });
}

test('four players: defender can intercept attacker A and attacker C separately',()=>{
 const h=harness(4),{ok,code,view}=h;
 ok(0,'v2:deploy',{code,index:0});
 // A needs a fresh turn before attacking.
 for(let i=0;i<4;i++){
  const p=view(0).current,hand=view(p).players[p].hand;
  ok(p,'v2:end',{code,overflowDiscardIndices:Array.from({length:Math.max(0,hand.length+2-5)},(_,j)=>j)});
 }
 ok(0,'v2:attack',{code,attackerIndex:0,defenderPlayerIndex:1});
 ok(1,'v2:respond-attack',{code,handIndex:0});
 assert.equal(view(1).players[1].interceptionUsedBy.p0,true);
 // Other attacker must have its own independent interception budget.
 assert.equal(view(1).players[1].interceptionUsedBy.p2,undefined);
});

test('invalid target payloads cannot mutate room state',()=>{
 const h=harness(3),{code,view,connections}=h;
 const before=JSON.stringify(view(0));
 for(const target of [undefined,null,'1',-1,0,3,1.5]){
  const attack=connections[0].call('v2:attack',{code,attackerIndex:0,defenderPlayerIndex:target});
  assert.equal(attack.ok,false,'invalid attack target '+String(target));
  const cast=connections[0].call('v2:cast',{code,magicIndex:0,mageIndex:0,defenderPlayerIndex:target});
  assert.equal(cast.ok,false,'invalid spell target '+String(target));
 }
 assert.equal(JSON.stringify(view(0)),before,'rejected operations must not change game state');
});

test('pending king attack blocks turn progression and other actions',()=>{
 const h=harness(2),{ok,code,view,connections}=h;
 ok(0,'v2:deploy',{code,index:0});
 for(let i=0;i<2;i++){
  const cur=view(0).current,hand=view(cur).players[cur].hand;
  ok(cur,'v2:end',{code,overflowDiscardIndices:Array.from({length:Math.max(0,hand.length+2-5)},(_,j)=>j)});
 }
 ok(0,'v2:attack',{code,attackerIndex:0,defenderPlayerIndex:1});
 assert.equal(connections[0].call('v2:end',{code}).ok,false);
 assert.equal(connections[0].call('v2:deploy',{code,index:0}).ok,false);
 assert.equal(connections[0].call('v2:cast',{code,magicIndex:0,mageIndex:0,defenderPlayerIndex:1}).ok,false);
 ok(1,'v2:respond-attack',{code,handIndex:null});
 assert.equal(view(0).pendingAttack,null);
});

test('king attacks and Louis sacrifice preserve the shared 60-card inventory',()=>{
 const h=harness(2),{ok,code,view}=h;
 ok(0,'v2:deploy',{code,index:0});
 ok(0,'v2:end',{code,overflowDiscardIndices:[0]});
 ok(1,'v2:deploy',{code,index:0});
 ok(1,'v2:end',{code,overflowDiscardIndices:[0]});
 ok(0,'v2:attack',{code,attackerIndex:0,defenderPlayerIndex:1});
 ok(1,'v2:respond-attack',{code,handIndex:null});
 // Every state emission now checks that the deck, discard, hands and fields
 // contain exactly 60 unique unit IDs; any lost/duplicated unit fails the ack.
 ok(0,'v2:end',{code,overflowDiscardIndices:[0,1]});
 ok(1,'v2:ability',{code,fieldIndex:0});
 assert.equal(view(1).players[1].field.length,0);
});
