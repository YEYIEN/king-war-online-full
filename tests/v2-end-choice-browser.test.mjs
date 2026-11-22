import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Server} from 'socket.io';
import {chromium} from 'playwright-core';
import {registerV2Playtest} from '../server/v2-playtest-socket.mjs';

const html=await readFile(new URL('../server/v2-playtest.html',import.meta.url));

for(const king of ['亞歷山大大帝','秦始皇']){
 test('Chromium: '+king+' uses native page choices to end turn and discard',{timeout:45000},async()=>{
  const http=createServer((req,res)=>{if(req.url?.startsWith('/v2-playtest')){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)}else{res.writeHead(404);res.end('not found')}});
  const io=new Server(http);registerV2Playtest(io);
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
  const ctx=await browser.newContext(),a=await ctx.newPage(),b=await ctx.newPage();
  try{
   a.setDefaultTimeout(10000);b.setDefaultTimeout(10000);
   let dialogs=0;
   a.on('dialog',async dialog=>{dialogs++;await dialog.dismiss()});
   const url='http://127.0.0.1:'+http.address().port+'/v2-playtest';
   await Promise.all([a.goto(url),b.goto(url)]);
   await a.locator('#king').selectOption({label:king});
   await a.getByRole('button',{name:'建立房間'}).click();
   await a.waitForFunction(()=>document.querySelector('#code').value.length===8);
   await b.locator('#code').fill(await a.locator('#code').inputValue());
   await b.getByRole('button',{name:'加入房間'}).click();
   await b.waitForFunction(()=>state?.players?.length===2);
   await a.getByRole('button',{name:'開始對戰'}).click();
   await a.waitForFunction(()=>state?.status==='playing');
   await a.locator('button[onclick="deploy(0)"]').click();
   await a.waitForFunction(()=>state.players[0].field.length===1);
   await a.getByRole('button',{name:'可視化抽牌／棄牌'}).click();
   await a.locator('#end-choice').waitFor();
   if(king==='秦始皇'){
    assert.match(await a.locator('#end-choice').innerText(),/從新抽三張兵種中/);
    await a.locator('#end-choice button[onclick="selectQinCard(2)"]').click();
   }
   const required=await a.evaluate(()=>Math.max(0,endDraftCards().length-5));
   for(let i=0;i<required;i++)await a.locator('#end-choice button[onclick="toggleEndDiscard('+i+')"]').click();
   assert.equal(await a.getByRole('button',{name:'確認結束回合'}).isEnabled(),true);
   await a.getByRole('button',{name:'確認結束回合'}).click();
   await b.waitForFunction(()=>state?.current===1);
   assert.equal(await a.locator('#error').textContent(),'');
   assert.equal(await b.evaluate(()=>state.players[0].hand),undefined,'do not expose opponent hand');
   assert.equal(dialogs,0,'native page wizard should not open dialogs');
   assert.equal(await a.locator('#end-choice').count(),0);
  }finally{await ctx.close();await browser.close();await new Promise(resolve=>io.close(resolve))}
 });
}
