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

test("the shipped beginner entry goes through the server-authoritative tutorial",()=>{
 assert.match(ui,/requestNow\("tutorial:start"/);
 assert.match(ui,/<GuidedTutorialCoach key=\{room\.roomCode\} progress=\{room\.tutorialProgress \|\| 0\}/);
 assert.doesNotMatch(ui,/function TutorialModal\(/);
 assert.doesNotMatch(ui,/function InteractiveTutorial\(/);
 assert.doesNotMatch(ui,/tutorialMode|showTutorial|tutorialSteps|tutorialStep/);
});
test("tutorial requires three contextual answers and supplies corrective explanations",()=>{
 assert.equal((ui.match(/prompt: "/g)||[]).length,3);
 assert.match(ui,/const TUTORIAL_RECALL_QUESTIONS = \[/);
 assert.match(ui,/questionIndex === TUTORIAL_RECALL_QUESTIONS\.length - 1/);
 assert.match(ui,/answer === question\.correct/);
 assert.match(ui,/aria-live="polite"/);
 assert.match(ui,/這是即時理解確認，不代表已掌握獨立對戰策略/);
});
test("card details have a single rule and instructions match the actual gesture behavior",()=>{
 assert.match(ui,/if \(shouldBlockUnitCardDetail\(card, source\)\) return;/);
 assert.match(ui,/兵種效果請查看卡面及規則頁/);
 assert.doesNotMatch(ui,/PLAY_AGAIN_FULLY_DISABLED_CLEAN_V1/);
});
