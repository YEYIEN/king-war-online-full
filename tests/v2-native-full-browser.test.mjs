import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Server} from 'socket.io';
import {chromium} from 'playwright-core';
import {registerV2Playtest} from '../server/v2-playtest-socket.mjs';

const html=await readFile(new URL('../server/v2-playtest.html',import.meta.url));
const order=cards=>{
 const archers=cards.filter(c=>c.type==='弓兵'&&c.rank==='高級');
 const used=new Set(archers.map(x=>x.id));
 return [...archers,...cards.filter(c=>!used.has(c.id))];
};
test('real Chromium: two players complete full match using page-native attack and end-turn choices',{timeout:120000},async()=>{
 const http=createServer((req,res)=>{if(req.url?.startsWith('/v2-playtest')){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)}else{res.writeHead(404);res.end('not found')}});
 const io=new Server(http);registerV2Playtest(io,{deckOrder:order});
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
 const ctx=await browser.newContext(),a=await ctx.newPage(),b=await ctx.newPage();
 try{
  let dialogs=0;
  for(const page of [a,b]){page.setDefaultTimeout(12000);page.on('dialog',async dialog=>{dialogs++;await dialog.dismiss()})}
  const url='http://127.0.0.1:'+http.address().port+'/v2-playtest';
  await Promise.all([a.goto(url),b.goto(url)]);
  await a.locator('#name').fill('A');
  await b.locator('#name').fill('B');
  await a.getByRole('button',{name:'建立房間'}).click();
  await a.waitForFunction(()=>document.querySelector('#code').value.length===8);
  const code=await a.locator('#code').inputValue();
  await b.locator('#code').fill(code);
  await b.getByRole('button',{name:'加入房間'}).click();
  await b.waitForFunction(()=>state?.players?.length===2);
  await a.getByRole('button',{name:'開始對戰'}).click();
  await Promise.all([a.waitForFunction(()=>state?.status==='playing'),b.waitForFunction(()=>state?.status==='playing')]);
  assert.equal(await a.evaluate(()=>state.players[1].hand),undefined);
  assert.equal(await b.evaluate(()=>state.players[0].hand),undefined);
  assert.equal(await a.evaluate(()=>state.players[0].hand.length),5);
  await a.locator('button[onclick="deploy(0)"]').click();
  await a.waitForFunction(()=>state.players[0].field.length===1);
  const end=async(page,expected)=>{
   await page.getByRole('button',{name:'可視化抽牌／棄牌'}).click();
   await page.locator('#end-choice').waitFor();
   const qin=await page.evaluate(()=>endDraft?.preview?.qin);
   if(qin)await page.locator('#end-choice button[onclick="selectQinCard(2)"]').click();
   const required=await page.evaluate(()=>Math.max(0,endDraftCards().length-5));
   for(let i=0;i<required;i++)await page.locator('#end-choice button[onclick="toggleEndDiscard('+i+')"]').click();
   await page.getByRole('button',{name:'確認結束回合'}).click();
   await page.waitForFunction(n=>state?.current===n,expected);
   const error=await page.locator('#error').textContent();
   assert.equal(error,'','turn must end without errors: '+error);
  };
  await end(a,1);
  await end(b,0);
  for(let attack=1;attack<=5;attack++){
   await a.getByRole('button',{name:'可視化攻擊／選目標'}).click();
   await a.locator('#tactic-choice .tactic-grid').nth(0).locator('button').first().click();
   await a.locator('#tactic-choice .tactic-grid').nth(1).locator('button').first().click();
   await a.locator('#tactic-choice button[onclick="chooseTacticKing()"]').click();
   await a.getByRole('button',{name:'確認戰術操作'}).click();
   await b.getByRole('button',{name:'不保牌，承受傷害'}).click();
   await Promise.all([a.waitForFunction(i=>state?.players?.[1]?.hp===Math.max(0,24-i*5),attack),b.waitForFunction(i=>state?.players?.[1]?.hp===Math.max(0,24-i*5),attack)]);
   if(attack!==5){await end(a,1);await end(b,0)}
  }
  await Promise.all([a.waitForFunction(()=>state.status==='finished'),b.waitForFunction(()=>state.status==='finished')]);
  assert.equal(await a.evaluate(()=>state.winner),'A');
  assert.equal(await b.evaluate(()=>state.winner),'A');
  assert.equal(await a.evaluate(()=>state.players[1].hand),undefined);
  assert.equal(await b.evaluate(()=>state.players[0].hand),undefined);
  assert.match(await a.locator('#game').innerText(),/勝者 A/);
  assert.match(await b.locator('#game').innerText(),/勝者 A/);
  assert.equal(dialogs,0,'native attack + end-choice match must not use browser dialogs');
 }finally{await ctx.close();await browser.close();await new Promise(resolve=>io.close(resolve))}
});
