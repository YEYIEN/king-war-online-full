import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Server} from 'socket.io';
import {chromium} from 'playwright-core';
import {registerV2Playtest} from '../server/v2-playtest-socket.mjs';

const html=await readFile(new URL('../server/v2-playtest.html',import.meta.url));
test('V2 mobile combat HUD and class icons at 320-430px',{timeout:60000},async()=>{
 const http=createServer((req,res)=>{if(req.url?.startsWith('/v2-playtest')){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)}else{res.writeHead(404);res.end('not found')}});
 const io=new Server(http);registerV2Playtest(io);
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
 const ctx=await browser.newContext(),a=await ctx.newPage(),b=await ctx.newPage();
 const errors=[];
 try{
  a.on('pageerror',e=>errors.push(e.message));
  for(const page of [a,b])page.setDefaultTimeout(10000);
  const url='http://127.0.0.1:'+http.address().port+'/v2-playtest';
  await Promise.all([a.goto(url),b.goto(url)]);
  await a.getByRole('button',{name:'建立房間'}).click();
  await a.waitForFunction(()=>document.querySelector('#code').value.length===8);
  await b.locator('#code').fill(await a.locator('#code').inputValue());
  await b.getByRole('button',{name:'加入房間'}).click();
  await b.waitForFunction(()=>state?.players?.length===2);
  await a.getByRole('button',{name:'開始對戰'}).click();
  await a.waitForFunction(()=>state?.status==='playing');
  assert.equal(await a.evaluate(()=>classEmblem('步兵')),'🛡️');
  assert.equal(await a.evaluate(()=>classEmblem('弓兵')),'🗡️');
  assert.equal(await a.evaluate(()=>classEmblem('法師')),'🔮');
  assert.equal(await a.evaluate(()=>classEmblem('騎兵')),'🐎');
  await a.locator('button[onclick="deploy(0)"]').click();
  await a.waitForFunction(()=>state?.players[0]?.field?.length===1);
  for(const width of [320,375,390,430]){
   await a.setViewportSize({width,height:780});
   const result=await a.evaluate(()=>({
    scrollWidth:document.documentElement.scrollWidth,
    viewport:window.innerWidth,
    hud:getComputedStyle(document.querySelector('#battle-hud')).display,
    emblems:[...document.querySelectorAll('.class-legend span')].map(e=>e.textContent),
    hp:document.querySelector('.hp-display')?.textContent,
    hand:document.querySelector('.hand-area')?.textContent
   }));
   assert.ok(result.scrollWidth<=result.viewport+2,'horizontal overflow at '+width+': '+result.scrollWidth);
   assert.notEqual(result.hud,'none','HUD invisible at '+width);
   assert.equal(result.emblems.length,4);
   assert.match(result.hp,/24 HP/);
   assert.ok(result.hand.length>0);
  }
  assert.deepEqual(errors,[],'no runtime script errors');
 }finally{await ctx.close();await browser.close();await new Promise(resolve=>io.close(resolve))}
});
