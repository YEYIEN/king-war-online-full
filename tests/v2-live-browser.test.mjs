import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const url=process.env.V2_LIVE_URL||'https://king-war-v2-playtest.onrender.com/v2-playtest';
test('deployed V2: two independent Chromium clients can join, deploy, and alternate turns',{timeout:100000},async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
 const ctx=await browser.newContext(),a=await ctx.newPage(),b=await ctx.newPage();
 try{
  for(const page of [a,b]){page.setDefaultTimeout(25000);page.on('dialog',async d=>{if(d.type()==='confirm')await d.dismiss();else await d.accept('1')});}
  for(const page of [a,b]){page.on('pageerror',e=>console.log('LIVE PAGE ERROR',e.message));page.on('response',r=>{if(r.url().includes('socket.io')&&r.status()>=400)console.log('LIVE SOCKET HTTP',r.status(),r.url())});}
  const responses=await Promise.all([a.goto(url,{waitUntil:'domcontentloaded',timeout:45000}),b.goto(url,{waitUntil:'domcontentloaded',timeout:45000})]);
  console.log('LIVE HTTP',responses.map(r=>r.status()));
  console.log('LIVE SOCKET STATE',await a.evaluate(()=>({connected:socket.connected,origin:location.origin,script:typeof io,error:document.querySelector('#error')?.textContent})));
  await a.waitForFunction(()=>socket.connected,{timeout:30000});
  await a.getByRole('button',{name:'建立房間'}).click();
  try{await a.waitForFunction(()=>document.querySelector('#code').value.length===8,{timeout:15000})}catch(e){console.log('LIVE CREATE FAILURE',await a.evaluate(()=>({connected:socket.connected,error:document.querySelector('#error').textContent,code:document.querySelector('#code').value})));throw e}
  const code=await a.locator('#code').inputValue();
  await b.locator('#code').fill(code);
  await b.getByRole('button',{name:'加入房間'}).click();
  await a.getByRole('button',{name:'開始對戰'}).click();
  await a.waitForFunction(()=>state?.status==='playing');
  await b.waitForFunction(()=>state?.status==='playing');
  assert.equal(await b.evaluate(()=>state.players[0].hand),undefined);
  await a.locator('button[onclick="deploy(0)"]').click();
  await b.waitForFunction(()=>state.players[0].field.length===1);
  await a.getByRole('button',{name:'結束回合'}).click();
  await b.waitForFunction(()=>state.current===1);
  await b.locator('button[onclick="deploy(0)"]').click();
  await a.waitForFunction(()=>state.players[1].field.length===1);
  await b.getByRole('button',{name:'結束回合'}).click();
  await a.waitForFunction(()=>state.current===0);
  assert.equal((await a.evaluate(()=>state.players[0].field)).length,1);
  console.log('LIVE V2 PASS',url,code);
 }finally{await ctx.close();await browser.close();}
});
