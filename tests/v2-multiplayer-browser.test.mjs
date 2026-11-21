import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Server} from 'socket.io';
import {chromium} from 'playwright-core';
import {registerV2Playtest} from '../server/v2-playtest-socket.mjs';

const html=await readFile(new URL('../server/v2-playtest.html',import.meta.url));
const order=cards=>{
 const archers=cards.filter(x=>x.type==='弓兵'&&x.rank==='高級');
 const picked=new Set(archers.map(x=>x.id));
 return [...archers,...cards.filter(x=>!picked.has(x.id))];
};
const waitForTurn=async(page,player)=>page.waitForFunction(i=>state?.status==='playing'&&state.current===i,player);
for(const size of [3,4,5]){
 test('real Chromium: '+size+' players complete an independent multiplayer match with private hands',{timeout:240000},async()=>{
  const http=createServer((req,res)=>{if(req.url?.startsWith('/v2-playtest')){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)}else{res.writeHead(404);res.end('not found')}});
  const io=new Server(http);registerV2Playtest(io,{deckOrder:order});
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
  const ctx=await browser.newContext(),pages=[];
  try{
   const url='http://127.0.0.1:'+http.address().port+'/v2-playtest';
   for(let i=0;i<size;i++){
    const p=await ctx.newPage();pages.push(p);p.setDefaultTimeout(12000);
    p.on('dialog',async d=>{
     if(d.type()==='confirm')return d.dismiss();
     if(d.type()==='prompt'){
      const n=d.message().match(/請選擇 ([0-9]+) 張棄置/);
      return d.accept(n?Array.from({length:Number(n[1])},(_,j)=>j+1).join(','):'1');
     }
     return d.accept();
    });
    await p.goto(url);await p.locator('#name').fill('P'+i);
   }
   await pages[0].getByRole('button',{name:'建立房間'}).click();
   await pages[0].waitForFunction(()=>document.querySelector('#code').value.length===8);
   const code=await pages[0].locator('#code').inputValue();
   for(let i=1;i<size;i++){
    await pages[i].locator('#code').fill(code);
    await pages[i].getByRole('button',{name:'加入房間'}).click();
    await pages[i].waitForFunction(n=>state?.players?.length===n,i+1);
   }
   await pages[0].getByRole('button',{name:'開始對戰'}).click();
   await Promise.all(pages.map(p=>p.waitForFunction(n=>state?.status==='playing'&&state.players.length===n,size)));
   for(let i=0;i<size;i++){
    const privacy=await pages[i].evaluate(i=>state.players.every((p,j)=>i===j?Array.isArray(p.hand):p.hand===undefined),i);
    assert.equal(privacy,true,'seat '+i+' must see only own hand');
   }
   const end=async(index)=>{
    const p=pages[index];
    await waitForTurn(p,index);
    await p.getByRole('button',{name:'結束回合'}).click();
    const expected=await p.evaluate(index=>{for(let step=1;step<=state.players.length;step++){const j=(index+step)%state.players.length;if(state.players[j].hp>0)return j}return -1},index);
    await p.waitForFunction(next=>state?.current===next,expected);
    assert.equal(await p.locator('#error').textContent(),'','end turn must be legal');
   };
   await pages[0].locator('button[onclick="deploy(0)"]').click();
   await pages[0].waitForFunction(()=>state.players[0].field.length===1);
   assert.equal(await pages[0].evaluate(()=>state.players[0].field[0].type),'弓兵');
   await end(0);
   for(let i=1;i<size;i++){
    await waitForTurn(pages[i],i);
    await pages[i].locator('button[onclick="deploy(0)"]').click();
    await end(i);
   }
   let hits=0;
   for(let victim=1;victim<size;victim++){
    for(let n=1;n<=5;n++){
     await waitForTurn(pages[0],0);
     await pages[0].locator('button[onclick="select(0)"]').click();
     await pages[0].locator('button[onclick="kingHit('+victim+')"]').click();
     await pages[victim].getByRole('button',{name:'不保牌，承受傷害'}).click();
     hits++;
     const hp=Math.max(0,24-n*5);
     await Promise.all([pages[0].waitForFunction(({victim,hp})=>state?.players?.[victim]?.hp===hp,{victim,hp}),pages[victim].waitForFunction(({victim,hp})=>state?.players?.[victim]?.hp===hp,{victim,hp})]);
     assert.equal(await pages[0].evaluate(()=>state.players.slice(1).filter(p=>p.hp>0).length),size-1-victim+(n<5?1:0));
     if(victim===size-1&&n===5)break;
     await end(0);
     for(let i=1;i<size;i++)if(await pages[0].evaluate(i=>state.players[i].hp>0,i))await end(i);
    }
   }
   await Promise.all(pages.map(p=>p.waitForFunction(()=>state?.status==='finished')));
   for(let i=0;i<size;i++){
    const s=await pages[i].evaluate(()=>state);
    assert.equal(s.winner,'P0','every seat must see the same winner');
    assert.equal(s.players.filter(x=>x.hp>0).length,1);
    assert.equal(s.players[0].hp,24);
    assert.equal(s.players.every((x,j)=>j===s.you?Array.isArray(x.hand):x.hand===undefined),true);
    assert.match(await pages[i].locator('#game').innerText(),/勝者 P0/);
   }
   assert.equal(hits,5*(size-1));
   console.log('MULTIPLAYER BROWSER PASS',size,'players',hits,'king hits');
  }finally{await ctx.close();await browser.close();await new Promise(resolve=>io.close(resolve))}
 });
}
