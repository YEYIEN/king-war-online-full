import {test} from "node:test";
import assert from "node:assert/strict";
import {originPolicy} from "../server/origin-policy.js";
const granted=(p,origin)=>new Promise((resolve,reject)=>p.allowRequest({headers:origin?{origin}:{}} ,(err,ok)=>err?reject(err):resolve(ok)));
test("optional Socket.IO origin filter works with exact allowed origins",async()=>{
 const p=originPolicy("https://example.com,https://play.example.com");
 assert.deepEqual(p.corsOrigins,["https://example.com","https://play.example.com"]);
 assert.equal(await granted(p,"https://example.com"),true);
 assert.equal(await granted(p,"https://play.example.com"),true);
 assert.equal(await granted(p,"https://evil.example.com"),false);
 assert.equal(await granted(p,"http://example.com"),false);
 assert.equal(await granted(p,null),false);
});
test("empty allowlist leaves development clients unaffected",async()=>{
 const p=originPolicy("");
 assert.equal(await granted(p,"https://any.example"),true);
 assert.equal(await granted(p,null),true);
});
test("invalid origins are rejected during server startup",()=>{
 for(const bad of ["javascript:alert(1)","https://example.com/path","https://example.com/","*","http://example.com,not-a-url"]){
  assert.throws(()=>originPolicy(bad));
 }
});
