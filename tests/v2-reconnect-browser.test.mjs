import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Server} from 'socket.io';
import {chromium} from 'playwright-core';
import {registerV2Playtest} from '../server/v2-playtest-socket.mjs';

const html=await readFile(new URL('../server/v2-playtest.html',import.meta.url));
test('real Chromium: disconnected player reloads into the same seat with private hand and rotated token',{timeout:60000},async()=>{
 const http=createServer((req,res)=>{if(req.url?.startsWith('/v2-playtest')){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)}else{res.writeHead(404);res.end('not found')}});
 const io=new Server(http);registerV2Playtest(io,{reconnectGraceMs:30000});
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
 const ctx=await browser.newContext(),a=await ctx.newPage(),b=await ctx.newPage();
 try{
  a.setDefaultTimeout(12000);b.setDefaultTimeout(12000);
  a.on('dialog',async dialog=>{
   if(dialog.type()==='prompt'){
    const match=dialog.message().match(/請選擇 ([0-9]+) 張棄置/);
    if(match)return dialog.accept(Array.from({length:Number(match[1])},(_,i)=>i+1).join(','));
   }
   if(dialog.type()==='confirm')return dialog.dismiss();
   return dialog.accept('1');
  });
  const url='http://127.0.0.1:'+http.address().port+'/v2-playtest';
  await Promise.all([a.goto(url),b.goto(url)]);
  await a.getByRole('button',{name:'建立房間'}).click();
  await a.waitForFunction(()=>document.querySelector('#code').value.length===8);
  const code=await a.locator('#code').inputValue();
  await b.locator('#code').fill(code);
  await b.getByRole('button',{name:'加入房間'}).click();
  await b.waitForFunction(()=>state?.you===1);
  await a.getByRole('button',{name:'開始對戰'}).click();
  await Promise.all([a.waitForFunction(()=>state?.status==='playing'),b.waitForFunction(()=>state?.status==='playing')]);
  const before=await b.evaluate(()=>({hand:state.players[1].hand.map(x=>x.id),token:JSON.parse(sessionStorage.getItem('kw_v2_resume'))?.resumeToken}));
  assert.equal(before.hand.length,5);
  assert.equal(before.token.length,64);
  await b.evaluate(()=>socket.disconnect());
  await a.waitForFunction(()=>state?.players[1]?.connected===false);
  assert.equal(await a.evaluate(()=>state.players[1].hp),24);
  await b.reload();
  await b.waitForFunction(()=>state?.you===1&&state?.players[1]?.connected===true);
  const after=await b.evaluate(()=>({hand:state.players[1].hand.map(x=>x.id),token:JSON.parse(sessionStorage.getItem('kw_v2_resume'))?.resumeToken,code:document.querySelector('#code').value}));
  assert.deepEqual(after.hand,before.hand);
  assert.notEqual(after.token,before.token);
  assert.equal(after.code,code);
  assert.equal(await a.evaluate(()=>state.players[1].hand),undefined);
  await a.getByRole('button',{name:'結束回合'}).click();
  await b.waitForFunction(()=>state.current===1);
  assert.equal(await a.locator('#error').textContent(),'','end turn after reconnect must succeed');
  assert.equal(await b.evaluate(()=>state.you),1);
  await b.locator('button[onclick="deploy(0)"]').click();
  await a.waitForFunction(()=>state.players[1].field.length===1);
 }finally{await ctx.close();await browser.close();await new Promise(resolve=>io.close(resolve))}
});
