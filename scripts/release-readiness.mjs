#!/usr/bin/env node
// Non-destructive release-readiness audit. It intentionally fails on P0 blockers.
// Usage: npm run release:check
import {readFileSync,existsSync} from "node:fs";
import {join} from "node:path";
const root=process.cwd();
const read=(path)=>readFileSync(join(root,path),"utf8");
const server=read("server/index.js");
const client=read("client/src/main.jsx");
const pkg=JSON.parse(read("package.json"));
const checks=[
 ["P0","Server-side verified Supabase identity","server/index.js",/auth\.getUser\s*\(|getClaims\s*\(|jwtVerify\s*\(/.test(server)],
 ["P0","Durable production match state configured","server/index.js",/active_matches|persistMatchToDatabase|saveMatchToSupabase/.test(server)],
 ["P0","Permanent match history writer","server/index.js",/match_history|match_participants/.test(server)],
 ["P0","Account deletion workflow","client/src/main.jsx",/刪除帳號|deleteAccount/.test(client)],
 ["P1","Socket abuse guard","server/socket-guard.js",existsSync(join(root,"server/socket-guard.js"))],
 ["P1","Automated gameplay tests","tests",existsSync(join(root,"tests")) && Boolean(pkg.scripts?.test)],
 ["P1","Mobile browser smoke test","scripts/production-browser-smoke.mjs",existsSync(join(root,"scripts/production-browser-smoke.mjs"))],
 ["P1","Release acceptance plan","docs/release-readiness-plan.md",existsSync(join(root,"docs/release-readiness-plan.md"))]
];
let blockers=0;
console.log("King War release-readiness audit (source-level signals, not proof of safety)\n");
for(const [severity,label,file,passed] of checks){
 console.log(`${passed?"PASS":"TODO"} [${severity}] ${label} (${file})`);
 if(!passed && severity==="P0")blockers++;
}
console.log(`\nP0 blockers requiring manual verification: ${blockers}`);
if(blockers)process.exitCode=1;
