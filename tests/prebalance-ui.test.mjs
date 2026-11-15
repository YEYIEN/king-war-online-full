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
test("beginner experience requires nine real game actions and has no multiple-choice quiz",()=>{
 assert.equal((ui.match(/where:"#kw-/g)||[]).length,9);
 assert.ok(ui.includes('第 ${progress+1} / ${GUIDED_LESSONS.length} 步'));
 assert.ok(ui.includes('room.tutorialProgress || 0'));
 assert.match(ui,/不需要回答考題/);
 assert.match(ui,/只有在正式戰場成功完成目前動作/);
 assert.doesNotMatch(ui,/TUTORIAL_RECALL_QUESTIONS|lessonChoiceGroup|questionIndex/);
});
test("combat interface starts from the hand and keeps the next action visible",()=>{
 assert.match(ui,/className="battleActionHub"/);
 assert.match(ui,/className="battleInstruction"/);
 assert.match(ui,/可行動兵種/);
 assert.ok(ui.indexOf('id="kw-hand"') < ui.indexOf('id="kw-enemy"'));
 assert.ok(ui.includes("取消選擇：{attacker.name}"));
});
test("card details have a single rule and instructions match the actual gesture behavior",()=>{
 assert.match(ui,/if \(shouldBlockUnitCardDetail\(card, source\)\) return;/);
 assert.match(ui,/兵種效果請查看卡面及規則頁/);
 assert.doesNotMatch(ui,/PLAY_AGAIN_FULLY_DISABLED_CLEAN_V1/);
});

test("king ability is keyboard-discoverable while unit cards retain normal click handling",()=>{
 assert.match(ui,/aria-label=\{`查看 \$\{player\.king\.name\} 的國王能力`\}/);
 assert.match(ui,/event\.key === "Enter" \|\| event\.key === " "/);
 assert.match(ui,/function canUnitStillAct\(card\)/);
 assert.match(ui,/me\?\.field\?\.filter\(canUnitStillAct\)/);
 assert.doesNotMatch(ui,/function openActionCardModal\(/);
 assert.doesNotMatch(ui,/actionCardModal/);
});
