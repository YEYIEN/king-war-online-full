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
 assert.match(smoke,/assert\.ok\(metrics\.horizontal<=1,/);
 assert.match(smoke,/metrics\.pageVertical<=3/);
 assert.match(smoke,/metrics\.mainVertical<=3/);
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
test("beginner experience requires eleven real game actions including last stand and has no multiple-choice quiz",()=>{
 assert.equal((ui.match(/where:"#kw-/g)||[]).length,11);
 assert.match(ui,/本章 \{chapterDone\} \/ \{chapterCount\} 項完成/);
 assert.ok(ui.includes('room.tutorialProgress || 0'));
 assert.match(ui,/className="lessonTask"/);
 assert.match(ui,/className="trialModalActions"/);
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
 assert.match(ui,/if \(!allowUnitInfo && shouldBlockUnitCardDetail\(card, source\)\) return;/);
 assert.match(ui,/className="kwUnitInfo"/);
 assert.match(ui,/onClick=\{\(\)=>onDetail\(card,"兵種",true\)\}/);
 assert.match(ui,/title="查看兵種效果"/);
 assert.doesNotMatch(ui,/PLAY_AGAIN_FULLY_DISABLED_CLEAN_V1/);
});

test("king ability is keyboard-discoverable while unit cards retain normal click handling",()=>{
 assert.match(ui,/aria-label=\{`查看 \$\{player\.name\} 的國王能力`\}/);
 assert.match(ui,/className="kwEnemyKingInfo"/);
 assert.match(ui,/type="button" className="kwKingChip own"/);
 assert.match(ui,/function canUnitStillAct\(card\)/);
 assert.match(ui,/me\?\.field\?\.filter\(canUnitStillAct\)/);
 assert.doesNotMatch(ui,/function openActionCardModal\(/);
 assert.doesNotMatch(ui,/actionCardModal/);
});

test("special abilities are taught contextually through usable controls rather than quiz answers",()=>{
 assert.match(ui,/特殊功能實戰提示/);
 assert.match(ui,/查看我的王權/);
 assert.match(ui,/成吉思汗可撤回騎兵，重新安排攻勢/);
 assert.match(ui,/逆境戰術已解鎖，可選擇突圍或固守/);
 assert.match(ui,/魔法已就緒。選擇魔法卡開始施放/);
 assert.doesNotMatch(ui,/TUTORIAL_RECALL_QUESTIONS/);
});

test("compact combat V3 retains essential gameplay controls and defers secondary content",()=>{
 assert.match(ui,/className=\{`page guidedPage kwCombatV3 /);
 assert.match(ui,/className="kwBattleFrame"/);
 assert.match(ui,/className="kwScoreStrip"/);
 assert.match(ui,/className="kwEnemyChips"/);
 assert.match(ui,/aria-label=\{`選擇對手/);
 assert.match(ui,/className="kwEnemyKingInfo"/);
 assert.ok(ui.includes('id="kw-field"'));
 assert.ok(ui.includes('id="kw-enemy"'));
 assert.ok(ui.includes('id="kw-hand"'));
 assert.match(ui,/className="endTurnBtn"/);
 assert.match(ui,/className="magicPanel guidedMagicPanel"/);
});
