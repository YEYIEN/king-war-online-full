import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('playtest HTML inline JavaScript parses before release',()=>{
 const html=readFileSync(new URL('./v2-playtest.html',import.meta.url),'utf8');
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(Boolean);
 assert.ok(scripts.length,'expected inline playtest script');
 for(const script of scripts)assert.doesNotThrow(()=>new vm.Script(script,{filename:'v2-playtest.html'}));
});
