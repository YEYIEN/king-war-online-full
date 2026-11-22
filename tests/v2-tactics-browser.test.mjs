import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Server} from 'socket.io';
import {chromium} from 'playwright-core';
import {registerV2Playtest} from '../server/v2-playtest-socket.mjs';

const html=await readFile(new URL('../server/v2-playtest.html',import.meta.url));
const order=cards=>{const units=cards.filter(c=>c.type==='弓兵'&&c.rank==='高級');const ids=new Set(units.map(x=>x.id));return [...units,...cards.filter(c=>!ids.has(c.id))]};
async function game(king,run){
 const http=createServer((req,res)=>{if(req.url?.startsWith('/v2-playtest')){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)}else{res.writeHead(404);res.end('not found')}});
 const io=new Server(http);registerV2Playtest(io,{deckOrder:order});
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
 const ctx=await browser.newContext(),a=await ctx.newPage(),b=await ctx.newPage();
 const dialogs=[];
 try{
  for(const p of [a,b]){p.setDefaultTimeout(12000);p.on('dialog',d=>{dialogs.push(d.message());return d.dismiss()});p.on('pageerror',e=>{dialogs.push('PAGE ERROR: '+e.message)})}
  const url='http://127.0.0.1:'+http.address().port+'/v2-playtest';
  await Promise.all([a.goto(url),b.goto(url)]);
  await a.locator('#king').selectOption({label:king});
  await a.locator('#name').fill('A');
  await b.locator('#name').fill('B');
  await a.getByRole('button',{name:'建立房間'}).click();
  await a.waitForFunction(()=>document.querySelector('#code').value.length===8);
  await b.locator('#code').fill(await a.locator('#code').inputValue());
  await b.getByRole('button',{name:'加入房間'}).click();
  await b.waitForFunction(()=>state?.players?.length===2);
  await a.getByRole('button',{name:'開始對戰'}).click();
  await Promise.all([a.waitForFunction(()=>state?.status==='playing'),b.waitForFunction(()=>state?.status==='playing')]);
  await run({a,b});
  assert.equal(dialogs.length,0,'new tactical flows must not invoke browser dialogs or have page errors: '+dialogs.join('; '));
  assert.equal(await a.evaluate(()=>state.players[1].hand),undefined);
  assert.equal(await b.evaluate(()=>state.players[0].hand),undefined);
 }finally{await ctx.close();await browser.close();await new Promise(resolve=>io.close(resolve))}
}
async function nativeEnd(page,next){
 await page.getByRole('button',{name:'可視化抽牌／棄牌'}).click();
 await page.locator('#end-choice').waitFor();
 if(await page.evaluate(()=>endDraft?.preview?.qin))await page.locator('#end-choice button[onclick="selectQinCard(2)"]').click();
 const n=await page.evaluate(()=>Math.max(0,endDraftCards().length-5));
 for(let i=0;i<n;i++)await page.locator('#end-choice button[onclick="toggleEndDiscard('+i+')"]').click();
 await page.getByRole('button',{name:'確認結束回合'}).click();
 await page.waitForFunction(i=>state.current===i,next);
 assert.equal(await page.locator('#error').textContent(),'');
}
test('real two-player Chromium: page-native attack chooses actor/opponent/king without dialogs',{timeout:60000},()=>game('亞歷山大大帝',async({a,b})=>{
 assert.equal(await a.locator('button[onclick="deploy(0)"]').getAttribute('data-art-id'),'assassin-advanced','cards must carry stable visual asset IDs');
 await a.locator('button[onclick="deploy(0)"]').click();
 await a.waitForFunction(()=>state.players[0].field.length===1);
 await nativeEnd(a,1);await nativeEnd(b,0);
 await a.getByRole('button',{name:'可視化攻擊／選目標'}).click();
 await a.locator('#tactic-choice button[onclick="chooseTactic(\'attackerIndex\',0)"]').click();
 await a.locator('#tactic-choice button[onclick="chooseTactic(\'defenderPlayerIndex\',1)"]').click();
 await a.locator('#tactic-choice button[onclick="chooseTacticKing()"]').click();
 assert.equal(await a.getByRole('button',{name:'確認戰術操作'}).isEnabled(),true);
 await a.getByRole('button',{name:'確認戰術操作'}).click();
 await b.getByRole('button',{name:'不保牌，承受傷害'}).click();
 await a.waitForFunction(()=>state?.players[1]?.hp===19);
 assert.equal(await a.locator('#error').textContent(),'');
}));
test('real two-player Chromium: page-native Genghis swap chooses field and hand',{timeout:60000},()=>game('成吉思汗',async({a,b})=>{
 await a.locator('button[onclick="deploy(0)"]').click();
 await a.waitForFunction(()=>state.players[0].field.length===1);
 await a.getByRole('button',{name:'可視化國王能力'}).click();
 await a.locator('#tactic-choice button[onclick="chooseTactic(\'fieldIndex\',0)"]').click();
 await a.locator('#tactic-choice button[onclick="chooseTactic(\'handIndex\',0)"]').click();
 await a.getByRole('button',{name:'確認戰術操作'}).click();
 await a.waitForFunction(()=>state.players[0].abilityUsed===true);
 assert.equal(await a.evaluate(()=>state.players[0].field.length),1);
 assert.equal(await a.evaluate(()=>state.players[0].hand.length),4);
 assert.equal(await a.locator('#error').textContent(),'');
}));
test('real two-player Chromium: page-native Louis sacrifice chooses field',{timeout:60000},()=>game('路易十四',async({a,b})=>{
 await a.locator('button[onclick="deploy(0)"]').click();
 await a.waitForFunction(()=>state.players[0].field.length===1);
 await nativeEnd(a,1);await nativeEnd(b,0);
 await a.getByRole('button',{name:'可視化國王能力'}).click();
 await a.locator('#tactic-choice button[onclick="chooseTactic(\'fieldIndex\',0)"]').click();
 await a.getByRole('button',{name:'確認戰術操作'}).click();
 await a.waitForFunction(()=>state.players[0].abilityUsed===true);
 assert.equal(await a.evaluate(()=>state.players[0].field.length),0);
 assert.equal(await a.locator('#error').textContent(),'');
}));
