import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Server} from 'socket.io';
import {chromium} from 'playwright-core';
import {registerV2Playtest} from '../server/v2-playtest-socket.mjs';
import {MAGIC_DEFS} from '../server/rules-v2-magic.mjs';
const html=await readFile(new URL('../server/v2-playtest.html',import.meta.url));
const ordered=spell=>cards=>{
 if(cards[0]?.name)return [...cards.filter(c=>c.name===spell),...cards.filter(c=>c.name!==spell)];
 const m=cards.filter(c=>c.type==='法師'&&c.rank==='高級'),i=cards.filter(c=>c.type==='步兵'&&c.rank==='初級');
 const ids=new Set([...m,...i].map(c=>c.id));return [...m,...i,...cards.filter(c=>!ids.has(c.id))];
};
test('real Chromium UI: two players cast all nine spells via visible controls', {timeout:240000},async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
 try{
  for(const spell of MAGIC_DEFS){
   const http=createServer((req,res)=>{if(req.url?.startsWith('/v2-playtest')){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)}else{res.writeHead(404);res.end('not found')}});
   const io=new Server(http);registerV2Playtest(io,{deckOrder:ordered(spell.name)});
   await new Promise(r=>http.listen(0,'127.0.0.1',r));
   const ctx=await browser.newContext(),a=await ctx.newPage(),b=await ctx.newPage();
   a.setDefaultTimeout(8000);b.setDefaultTimeout(8000);
   console.log('BROWSER SPELL',spell.name);
   try{
    const url='http://127.0.0.1:'+http.address().port+'/v2-playtest';
    await Promise.all([a.goto(url),b.goto(url)]);
    console.log('loaded',spell.name);
    for(const page of [a,b])page.on('dialog',async dialog=>{if(dialog.type()==='confirm')await dialog.dismiss();else await dialog.accept('1')});
    await a.getByRole('button',{name:'建立房間'}).click();
    await a.waitForFunction(()=>document.querySelector('#code').value.length>0);
    const code=await a.locator('#code').inputValue();
    await b.locator('#code').fill(code);
    await b.getByRole('button',{name:'加入房間'}).click();
    await a.getByRole('button',{name:'開始對戰'}).click();
    await a.waitForFunction(()=>state?.status==='playing',{timeout:8000});
    await b.waitForFunction(()=>state?.status==='playing',{timeout:8000});
    console.log('started',spell.name);
    await a.locator('button[onclick="deploy(0)"]').click();
    await a.getByRole('button',{name:'結束回合'}).click();
    await b.waitForFunction(()=>state?.current===1);
    await b.locator('button[onclick="deploy(0)"]').click();
    await b.getByRole('button',{name:'結束回合'}).click();
    await a.waitForFunction(()=>state?.current===0&&state?.players[0]?.availableSpells?.length===9,{timeout:8000});
    console.log('drawn',spell.name);
    const magicIndex=MAGIC_DEFS.findIndex(m=>m.name===spell.name);
    await a.locator('button[onclick="cast('+magicIndex+')"]').click();
    await a.waitForFunction(name=>state?.players[0]?.field?.[0]?.tapped===true&&state?.log?.some(x=>x.includes('施放 '+name)),spell.name);
    await b.waitForFunction(()=>state?.log?.some(x=>x.includes('施放')));
    const stateA=await a.evaluate(()=>state),stateB=await b.evaluate(()=>state);
    assert.equal(stateA.log.at(-1).includes(spell.name),true,spell.name);
    assert.deepEqual(stateA.players[0].field,stateB.players[0].field);
    assert.deepEqual(stateA.players[1].field,stateB.players[1].field);
    assert.equal(stateB.players[0].availableSpells,undefined);
    assert.equal(stateB.players[0].hand,undefined);
    assert.equal(stateA.players[1].hand,undefined);
   }finally{await ctx.close();await new Promise(r=>io.close(r));}
  }
 }finally{await browser.close();}
});
