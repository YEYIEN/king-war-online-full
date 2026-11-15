import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import { spawn } from "node:child_process";
import net from "node:net";
import { chromium } from "playwright";

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server/index.js"], {
  env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});
let stderr = "";
child.stderr.on("data", part => { stderr += part.toString(); });
let browser;

try {
  let available = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`Production server exited: ${stderr}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok && (await response.text()).includes('id="root"')) {
        available = true;
        break;
      }
    } catch { /* Starting up */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(available, `Production index.html was not available: ${stderr}`);

  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const host = await desktop.newPage();
  const guest = await mobile.newPage();
  const runtimeErrors = [];
  for (const page of [host, guest]) {
    page.on("pageerror", error => runtimeErrors.push(error.message));
  }

  await host.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await host.getByRole("heading", { name: "國王戰爭" }).waitFor();
  await host.getByPlaceholder("例如 Wayne；不填會自動產生 ID").fill("DesktopHost");
  await host.getByRole("button", { name: "創建私人房間" }).click();
  await host.getByText("房主設定").waitFor();
  const roomCode = (await host.locator("h1").innerText()).trim();
  assert.match(roomCode, /^[A-Z0-9]{4,12}$/, "host receives a room code");

  await guest.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await guest.getByRole("heading", { name: "國王戰爭" }).waitFor();
  await guest.getByPlaceholder("例如 Wayne；不填會自動產生 ID").fill("MobileGuest");
  await guest.getByPlaceholder("例如 KW1234").fill(roomCode);
  await guest.getByRole("button", { name: "加入房間" }).click();
  await guest.getByRole("button", { name: "我準備好了" }).waitFor();
  await guest.getByRole("button", { name: "我準備好了" }).click();
  await guest.getByRole("button", { name: "取消準備" }).waitFor();

  await host.getByRole("button", { name: "開始遊戲" }).waitFor();
  await host.getByRole("button", { name: "開始遊戲" }).click();
  await host.getByText("結束回合", { exact: true }).first().waitFor({ timeout: 10000 });
  await guest.getByText("結束回合", { exact: true }).first().waitFor({ timeout: 10000 });

  if(process.env.KW_CAPTURE_UI==="1") {
    await mkdir("test-artifacts/ui",{recursive:true});
    await host.screenshot({path:"test-artifacts/ui/desktop-battle.png",fullPage:true});
    await guest.screenshot({path:"test-artifacts/ui/mobile-battle.png",fullPage:true});
  }
  const overflow = await guest.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `Mobile view has ${overflow}px horizontal overflow`);
  for (const width of [320, 375, 390, 430]) {
    await guest.setViewportSize({width, height:844});
    const metrics = await guest.evaluate(() => {
      const main=document.querySelector(".kwCombatV3");
      const frame=document.querySelector(".kwBattleFrame");
      const required=[".kwScoreStrip",".battleGrid",".battleActionHub",".handAndLog"];
      const bounds=required.map(sel=>{
        const el=document.querySelector(sel);
        if(!el)return {selector:sel,missing:true};
        const b=el.getBoundingClientRect();
        return {selector:sel,top:b.top,bottom:b.bottom,left:b.left,right:b.right,missing:false};
      });
      return {
        horizontal:document.documentElement.scrollWidth-window.innerWidth,
        pageVertical:document.documentElement.scrollHeight-window.innerHeight,
        mainVertical:main.scrollHeight-main.clientHeight,
        frameVertical:frame.scrollHeight-frame.clientHeight,
        bounds,
        grid:window.getComputedStyle(frame).gridTemplateAreas
      };
    });
    assert.ok(metrics.horizontal<=1,`Mobile ${width}px horizontal overflow: ${metrics.horizontal}px`);
    assert.ok(metrics.pageVertical<=3,`Mobile ${width}px vertical page scroll: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.mainVertical<=3,`Mobile ${width}px combat scroll: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.frameVertical<=3,`Mobile ${width}px combat frame overflow: ${JSON.stringify(metrics)}`);
    assert.match(metrics.grid,/score.*arena.*command.*hand/,`Mobile ${width}px missing focused combat grid`);
    for(const el of metrics.bounds){
      assert.ok(!el.missing,`Mobile missing ${el.selector}`);
      assert.ok(el.top>=-2&&el.bottom<=846,`Mobile ${width}px element ${el.selector} out of viewport: ${JSON.stringify(el)}`);
    }
  }
  await guest.setViewportSize({width:390,height:844});
  // The tutorial now uses actual game actions rather than static click-through slides.
  const trainee = await mobile.newPage();
  trainee.on("pageerror", error => runtimeErrors.push(error.message));
  await trainee.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await trainee.getByRole("button", { name: "開始操作教學" }).click();
  await trainee.getByRole("heading", { name: "部署第一名兵種" }).waitFor({ timeout: 10000 });
  await trainee.getByText("現在親手操作", { exact: false }).first().waitFor();
  await trainee.getByRole("link",{name:/前往「手牌與部署」操作/}).waitFor();
  assert.equal(await trainee.locator(".lessonChoiceGroup").count(),0,"no tutorial quizzes");
  if(process.env.KW_CAPTURE_UI==="1") await trainee.screenshot({path:"test-artifacts/ui/mobile-tutorial.png",fullPage:true});
  // Click the real UI through every tutorial step, including magic confirmation,
  // unit and king attacks, a scripted opponent turn and a second defensive round.
  const step=async name=>trainee.getByRole("heading",{name}).waitFor({timeout:10000});
  const tapCard=(zone,name)=>trainee.locator(zone).locator(".gameCard").filter({hasText:name}).first().click();
  await trainee.locator(".handCard").filter({hasText:"中級騎兵"}).first().click();
  await trainee.locator(".mobileActionPanel .primaryBtn").click();
  await step("用法師施放力量術");
  await tapCard(".magicList","力量術");
  await trainee.locator(".mobileActionPanel .primaryBtn").click();
  await tapCard(".guidedMagicPanel .cardGrid","初級法師");
  await trainee.getByRole("button",{name:"確認施法者"}).click();
  await tapCard(".guidedMagicPanel .cardGrid","中級騎兵");
  await trainee.getByRole("button",{name:"確認目標"}).click();
  await trainee.getByRole("button",{name:"確認施放"}).click();
  await step("選攻擊者，再選敵方兵種");
  await tapCard(".myZone","中級騎兵");
  await tapCard(".enemyZone","中級弓兵");
  await step("直接攻擊敵方國王");
  await tapCard(".myZone","初級騎兵");
  await trainee.locator(".enemyZone .dangerBtn").click();
  await step("結束第一個回合");
  await trainee.getByRole("button",{name:"結束回合",exact:true}).click();
  await step("先部署步兵保護國王");
  await trainee.locator(".handCard").filter({hasText:"中級步兵"}).first().click();
  await trainee.locator(".mobileActionPanel .primaryBtn").click();
  await step("利用騎兵剋制清除步兵");
  await tapCard(".myZone","中級騎兵");
  await tapCard(".enemyZone","初級步兵");
  await step("防線突破後繼續攻擊國王");
  await tapCard(".myZone","初級騎兵");
  await trainee.locator(".enemyZone .dangerBtn").click();
  await step("完成一整輪攻防操作");
  trainee.once("dialog",dialog=>dialog.accept());
  await trainee.getByRole("button",{name:"結束回合",exact:true}).click();
  await trainee.getByRole("heading",{name:"你已經親手完成兩個戰鬥回合！"}).waitFor({timeout:10000});
  assert.equal(await trainee.locator(".lessonChoiceGroup").count(),0,"tutorial has no quizzes");
  if(process.env.KW_CAPTURE_UI==="1") await trainee.screenshot({path:"test-artifacts/ui/mobile-tutorial-complete.png",fullPage:true});
  await trainee.close();

  const aiMenu = await desktop.newPage();
  aiMenu.on("pageerror", error => runtimeErrors.push(error.message));
  await aiMenu.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await aiMenu.getByRole("button", { name: "困難", exact: true }).click();
  await aiMenu.getByRole("button", { name: "開始單人對戰" }).click();
  await aiMenu.getByRole("button", { name: "結束回合" }).waitFor({ timeout: 10000 });
  if(process.env.KW_CAPTURE_UI==="1") await aiMenu.screenshot({path:"test-artifacts/ui/desktop-ai.png",fullPage:true});
  await aiMenu.close();

  assert.deepEqual(runtimeErrors, [], "no JavaScript exceptions in multiplayer, tutorial or AI");
  console.log(`Production browser smoke passed: room=${roomCode}; desktop + mobile + tutorial + AI; horizontal overflow=${overflow}px`);
} finally {
  if (browser) await browser.close();
  child.kill("SIGTERM");
}
