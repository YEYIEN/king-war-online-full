import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const ui=readFileSync(new URL("../client/src/main.jsx",import.meta.url),"utf8");
const smoke=readFileSync(new URL("../scripts/production-browser-smoke.mjs",import.meta.url),"utf8");
test("completed results remain visible until player chooses a return action",()=>{
 assert.match(ui,/onClick=\{returnHomeFromResult\}>返回主選單/);
 assert.doesNotMatch(ui,/AUTO_RETURN_HOME_AFTER_RESULT_CLEAN_V1/);
 assert.doesNotMatch(ui,/結果畫面將停留 5 秒/);
});
test("mobile browser test rejects nontrivial overflow at four widths",()=>{
 assert.match(smoke,/\[320, 375, 390, 430\]/);
 assert.match(smoke,/assert\.ok\(actual <= 1,/);
});

test("all lobby and gameplay commands use the bounded, deduplicated request path",()=>{
 assert.equal((ui.match(/socket\.emit\(/g)||[]).length,0);
 assert.match(ui,/socket\.timeout\(5000\)\.emit\(event, data,/);
 assert.match(ui,/pendingRequestsRef\.current\.has\(event\)/);
 assert.match(ui,/connectionWarning.*role="status".*aria-live="polite"/s);
});
