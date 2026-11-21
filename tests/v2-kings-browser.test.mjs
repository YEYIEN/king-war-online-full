import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Server} from 'socket.io';
import {chromium} from 'playwright-core';
import {registerV2Playtest} from '../server/v2-playtest-socket.mjs';
const html=await readFile(new URL('../server/v2-playtest.html',import.meta.url));
const deckOrder=cards=>{
 if(cards[0]?.name)return cards;
 const infantry=cards.filter(c=>c.type==='步兵'&&c.rank==='中級');
 const archers=cards.filter(c=>c.type==='弓兵'&&c.rank==='高級');
 const cavalry=cards.find(c=>c.type==='騎兵'&&c.rank==='高級');
 // Seat A gets a medium infantry first; seat B gets a matching infantry first.
 const picked=[infantry[0],...archers,cavalry,infantry[1]],ids=new Set(picked.map(c=>c.id));
 return [...picked,...cards.filter(c=>!ids.has(c.id))];
};
test('five king powers: real Chromium two-player controls and synchronized state',{timeout:180000},async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
 try{
  for(const king of ['亞歷山大大帝','屋大維奧古斯都','成吉思汗','秦始皇','路易十四']){
   console.log('KING BROWSER',king);
   const http=createServer((req,res)=>{if(req.url?.startsWith('/v2-playtest')){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)}else{res.writeHead(404);res.end('not found')}});
   const io=new Server(http);registerV2Playtest(io,{deckOrder});
   await new Promise(r=>http.listen(0,'127.0.0.1',r));
   const ctx=await browser.newContext(),a=await ctx.newPage(),b=await ctx.newPage();
   try{
    a.setDefaultTimeout(10000);b.setDefaultTimeout(10000);
    for(const p of [a,b])p.on('dialog',async d=>{if(d.type()==='confirm')return d.accept();if(d.type()==='prompt'){const match=d.message().match(/請選擇 ([0-9]+) 張棄置/);const count=match?Number(match[1]):1;return d.accept(Array.from({length:count},(_,i)=>i+1).join(','))}return d.accept()});
    const url='http://127.0.0.1:'+http.address().port+'/v2-playtest';
    await Promise.all([a.goto(url),b.goto(url)]);
    await a.locator('#king').selectOption({label:king});
    await a.getByRole('button',{name:'建立房間'}).click();
    await a.waitForFunction(()=>document.querySelector('#code').value.length===8);
    const code=await a.locator('#code').inputValue();
    await b.locator('#code').fill(code);
    await b.getByRole('button',{name:'加入房間'}).click();
    await a.getByRole('button',{name:'開始對戰'}).click();
    await a.waitForFunction(()=>state?.status==='playing');
    assert.equal((await a.evaluate(()=>state.players[0].king)),king);
    await a.locator('button[onclick="deploy(0)"]').click();
    if(king==='成吉思汗'){
     await a.getByRole('button',{name:'使用國王能力'}).click();
     await a.waitForFunction(()=>state.players[0].abilityUsed===true);
     assert.equal((await b.evaluate(()=>state.players[0].field.length)),1);
     assert.equal((await a.evaluate(()=>state.players[0].hand.length)),4);
    }else{
     await a.getByRole('button',{name:'結束回合'}).click();
     await b.waitForFunction(()=>state.current===1);
     await b.locator('button[onclick="deploy(0)"]').click();
     await b.getByRole('button',{name:'結束回合'}).click();
     await a.waitForFunction(()=>state.current===0);
     if(king==='路易十四'){
      await a.getByRole('button',{name:'使用國王能力'}).click();
      await a.waitForFunction(()=>state.players[0].abilityUsed===true);
      assert.equal((await b.evaluate(()=>state.players[0].field.length)),0);
     }else if(king==='秦始皇'){
      await a.getByRole('button',{name:'結束回合'}).click();
      await b.waitForFunction(()=>state.current===1);
      assert.equal((await a.evaluate(()=>state.players[0].hand.length)),5);
     }else if(king==='亞歷山大大帝'){
      await a.locator('button[onclick="select(0)"]').click();
      await a.locator('button[onclick="hit(0,1)"]').click();
      await a.waitForFunction(()=>state.players[0].abilityUsed===true);
      assert.equal((await b.evaluate(()=>state.players[0].abilityUsed)),true);
     }else if(king==='屋大維奧古斯都'){
      await a.getByRole('button',{name:'結束回合'}).click();
      await b.waitForFunction(()=>state.current===1);
      const before=await b.evaluate(()=>({attacker:state.players[1].field[0],defender:state.players[0].field[0],current:state.current,logLength:state.log.length}));
      console.log('AUGUSTUS BEFORE',JSON.stringify(before));
      await b.locator('button[onclick="select(0)"]').click();
      await b.locator('button[onclick="hit(0,0)"]').click();
      await b.waitForFunction(n=>state.log.length>n||Boolean(document.querySelector('#error')?.textContent),before.logLength);
      const snapshot=await b.evaluate(()=>({error:document.querySelector('#error')?.textContent,log:state.log.slice(-3),turn:state.turn,current:state.current,attacker:state.players[1].field,defender:state.players[0].field,defenderKing:state.players[0].king}));
      console.log('AUGUSTUS AFTER',JSON.stringify(snapshot));
      assert.equal(snapshot.error,'','attack must not be rejected');
      assert.ok(snapshot.log.some(x=>x.includes('兵種戰鬥')),'battle must be resolved by server');
      assert.equal(snapshot.attacker.length,0,'equal-power attacker must die');
      assert.equal(snapshot.defender.length,1,'Augustus defender survives equal-power tie');
     }
    }
   }finally{await ctx.close();await new Promise(r=>io.close(r));}
  }
 }finally{await browser.close();}
});
