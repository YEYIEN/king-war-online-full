import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Server} from 'socket.io';
import {chromium} from 'playwright-core';
import {registerV2Playtest} from '../server/v2-playtest-socket.mjs';
import {MAGIC_DEFS} from '../server/rules-v2-magic.mjs';

const html=await readFile(new URL('../server/v2-playtest.html',import.meta.url));
const ordered=cards=>{
 const m=cards.filter(c=>c.type==='法師'&&c.rank==='高級'),i=cards.filter(c=>c.type==='步兵'&&c.rank==='初級');
 const ids=new Set([...m,...i].map(c=>c.id));return [...m,...i,...cards.filter(c=>!ids.has(c.id))];
};
async function endNative(page,next){
 await page.getByRole('button',{name:'可視化抽牌／棄牌'}).click();
 await page.locator('#end-choice').waitFor();
 const qin=await page.evaluate(()=>endDraft?.preview?.qin);
 if(qin)await page.locator('#end-choice button[onclick="selectQinCard(2)"]').click();
 const excess=await page.evaluate(()=>Math.max(0,endDraftCards().length-5));
 for(let i=0;i<excess;i++)await page.locator('#end-choice button[onclick="toggleEndDiscard('+i+')"]').click();
 await page.getByRole('button',{name:'確認結束回合'}).click();
 await page.waitForFunction(i=>state?.current===i,next);
 assert.equal(await page.locator('#error').textContent(),'');
}
test('nine spells: two Chromium clients use page-native mage, opponent and target buttons without dialogs',{timeout:240000},async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
 try{
  for(const [magicIndex,spell] of MAGIC_DEFS.entries()){
   const http=createServer((req,res)=>{if(req.url?.startsWith('/v2-playtest')){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)}else{res.writeHead(404);res.end('not found')}});
   const io=new Server(http);registerV2Playtest(io,{deckOrder:ordered});
   await new Promise(r=>http.listen(0,'127.0.0.1',r));
   const ctx=await browser.newContext(),a=await ctx.newPage(),b=await ctx.newPage();
   const errors=[];
   try{
    for(const page of [a,b]){page.setDefaultTimeout(10000);page.on('dialog',async d=>{errors.push('Unexpected dialog: '+d.message());await d.dismiss()});page.on('pageerror',e=>errors.push(e.message))}
    const url='http://127.0.0.1:'+http.address().port+'/v2-playtest';
    await Promise.all([a.goto(url),b.goto(url)]);
    await a.locator('#name').fill('法師');
    await b.locator('#name').fill('守軍');
    await a.getByRole('button',{name:'建立房間'}).click();
    await a.waitForFunction(()=>document.querySelector('#code').value.length>0);
    await b.locator('#code').fill(await a.locator('#code').inputValue());
    await b.getByRole('button',{name:'加入房間'}).click();
    await b.waitForFunction(()=>state?.players.length===2);
    await a.getByRole('button',{name:'開始對戰'}).click();
    await a.waitForFunction(()=>state?.status==='playing');
    await a.locator('button[onclick="deploy(0)"]').click();
    await a.waitForFunction(()=>state.players[0].field.length===1);
    await endNative(a,1);
    await b.locator('button[onclick="deploy(0)"]').click();
    await b.waitForFunction(()=>state.players[1].field.length===1);
    await endNative(b,0);
    await a.getByRole('button',{name:'可視化施放｜'+spell.name}).click();
    await a.locator('#magic-choice').waitFor();
    await a.locator('#magic-choice button[onclick="chooseMagicMage(0)"]').click();
    await a.locator('#magic-choice button[onclick="chooseMagicOpponent(1)"]').click();
    if(spell.maxTargets>0){
     await a.locator('#magic-choice button[onclick="chooseMagicTarget(0)"]').click();
    }else assert.equal(await a.locator('#magic-choice button[onclick^="chooseMagicTarget"]').count(),0,'meteor no unit targets');
    await a.getByRole('button',{name:'確認施放魔法'}).click();
    await a.waitForFunction(name=>state?.log?.some(x=>x.includes('施放 '+name)),spell.name);
    await b.waitForFunction(name=>state?.log?.some(x=>x.includes('施放 '+name)),spell.name);
    assert.equal(await a.locator('#error').textContent(),'',spell.name+' server outcome');
    assert.equal(await a.evaluate(()=>state.players[0].field[0].tapped),true,spell.name+' mage tapped');
    assert.equal(await a.evaluate(()=>state.players[1].hand),undefined);
    assert.equal(await b.evaluate(()=>state.players[0].hand),undefined);
    assert.deepEqual(errors,[],spell.name+' unexpected browser dialogs or errors');
    console.log('NATIVE MAGIC PASS',spell.name);
   }finally{await ctx.close();await new Promise(r=>io.close(r))}
  }
 }finally{await browser.close()}
});
