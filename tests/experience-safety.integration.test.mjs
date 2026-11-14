import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import net from "node:net";

const { io } = createRequire(new URL("../client/package.json",import.meta.url))("socket.io-client");
async function freePort() {
  const server = net.createServer();
  await new Promise((res, rej) => server.once("error",rej).listen(0,"127.0.0.1",res));
  const port=server.address().port;
  await new Promise(res=>server.close(res));
  return port;
}
function request(socket,event,payload={}) {
  return new Promise((res,rej)=>socket.timeout(4000).emit(event,payload,(err,data)=>err?rej(err):res(data)));
}
async function connect(port) {
  const socket=io(`http://127.0.0.1:${port}`,{transports:["websocket"],reconnection:false,timeout:1200});
  await new Promise((res,rej)=>{socket.once("connect",res);socket.once("connect_error",rej)});
  return socket;
}
async function withRoom(t, size, fn) {
  const port=await freePort();
  const child=spawn(process.execPath,["server/index.js"],{
    cwd:fileURLToPath(new URL("../",import.meta.url)),env:{...process.env,PORT:String(port),NODE_ENV:"development"},stdio:"ignore"
  });
  const sockets=[];
  t.after(()=>{sockets.forEach(s=>s.disconnect());child.kill("SIGTERM")});
  let first;
  for(let i=0;i<40;i++){
    try{first=await connect(port);break;}catch(e){if(child.exitCode!==null||i===39)throw e;await new Promise(res=>setTimeout(res,100))}
  }
  sockets.push(first);
  const created=await request(first,"room:create",{name:"P0",maxPlayers:size});
  assert.equal(created.ok,true);
  const members=[{socket:first,...created}];
  for(let i=1;i<size;i++){
    const socket=await connect(port);sockets.push(socket);
    const joined=await request(socket,"room:join",{name:`P${i}`,code:created.room.roomCode});
    assert.equal(joined.ok,true);members.push({socket,...joined});
    assert.equal((await request(socket,"room:toggleReady")).ok,true);
  }
  const byId=new Map(members.map(m=>[m.playerId,m]));
  const view=async()=>{const m=members[0];return (await request(m.socket,"room:resume",{
    roomCode:created.room.roomCode,playerId:m.playerId,resumeToken:m.resumeToken
  })).room;};
  await fn({members,byId,view,created});
}
test("fair opening toggle stops first combat without blocking later turns", {timeout:20000},async t=>{
  await withRoom(t,2,async({members,byId,view})=>{
    const host=members[0].socket;
    assert.equal((await request(host,"room:updateSettings",{fairOpening2P:true})).ok,true);
    assert.equal((await request(host,"game:start")).ok,true);
    const room=await view();
    assert.equal(room.settings.firstSeatPeacefulTurn,true);
    assert.equal(room.settings.secondSeatExtraCards,1);
    const initial=byId.get(room.currentPlayerId);
    const enemy=room.players.find(p=>p.id!==initial.playerId);
    const blocked=await request(initial.socket,"game:attackKing",{attackerId:"missing",targetPlayerId:enemy.id});
    assert.equal(blocked.ok,false);
    assert.match(blocked.error,/戰前部署|不可攻擊/);
    assert.equal((await request(initial.socket,"game:endTurn")).ok,true);
    const second=await view();
    assert.equal(second.currentPlayerId,enemy.id);
    const resumed=byId.get(second.currentPlayerId);
    const testAttack=await request(resumed.socket,"game:attackKing",{attackerId:"missing",targetPlayerId:initial.playerId});
    assert.equal(testAttack.ok,false);
    assert.doesNotMatch(testAttack.error,/戰前部署期間/);
    assert.equal((await request(host,"room:updateSettings",{fairOpening2P:false})).ok,false);
    assert.equal((await request(resumed.socket,"game:lastStand",{mode:"unrecognized"})).ok,false);
  });
});
test("Mongol recall never overflows hand after many full round passes", {timeout:30000},async t=>{
  await withRoom(t,5,async({members,byId,view})=>{
    assert.equal((await request(members[0].socket,"game:start")).ok,true);
    let room=await view();
    const mongol=room.players.find(p=>p.king?.name==="成吉思汗");
    assert.ok(mongol,"five players include exactly one Mongol");
    let deployedId=null;
    for(let n=0;n<30;n++){
      room=await view();
      const current=byId.get(room.currentPlayerId);
      assert.ok(current,"playing current seat is active");
      if(current.playerId===mongol.id){
        const me=room.players.find(p=>p.id===mongol.id);
        if(!deployedId){
          const troop=me.hand.find(u=>u.type!=="騎兵"&&u.rank!=="高級") || me.hand.find(u=>u.type!=="騎兵");
          assert.ok(troop);
          assert.equal((await request(current.socket,"game:deploy",{cardId:troop.id})).ok,true);
          deployedId=troop.id;
        }else if(me.hand.length===7){
          const out=await request(current.socket,"game:recall",{unitId:deployedId});
          assert.equal(out.ok,true,JSON.stringify(out));
          const after=await view();
          const returned=after.players.find(p=>p.id===mongol.id);
          assert.ok(returned.hand.length<=7,"recall must respect hand cap even without bonus draw");
          assert.deepEqual(returned.hand.find(u=>u.id===deployedId)?.status,[],"returned card has no stale status");
          assert.equal((await request(current.socket,"game:recall",{unitId:deployedId})).ok,false,"recall once per turn");
          return;
        }
      }
      assert.equal((await request(current.socket,"game:endTurn")).ok,true);
    }
    assert.fail("could not reach full Mongol hand within 30 passive turns");
  });
});
