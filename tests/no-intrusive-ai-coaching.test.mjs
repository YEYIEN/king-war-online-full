import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("normal AI matches do not add instructional scripts or suggested player actions",()=>{
 const server=readFileSync(new URL("../server/index.js",import.meta.url),"utf8");
 const client=readFileSync(new URL("../client/src/main.jsx",import.meta.url),"utf8");
 assert.doesNotMatch(server,/room\.log\.push\([^\n]*(?:學習提示|戰術提示)/);
 assert.doesNotMatch(client,/簡單：練習部署|中等：學會兵種剋制|困難：需要規劃資源/);
});
test("strategy difficulty affects AI decisions, not human event handler rule permissions",()=>{
 const server=readFileSync(new URL("../server/index.js",import.meta.url),"utf8");
 const publicHandlers=server.slice(server.indexOf('guardedOn("game:deploy"'),server.indexOf('socket.on("disconnect"'));
 assert.ok(publicHandlers.length>500,"confirm gameplay event handler area exists");
 assert.doesNotMatch(publicHandlers,/getAIDifficulty\(/,"normal player actions must not be gated by chosen AI difficulty");
});
