import assert from "node:assert/strict";
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

  const overflow = await guest.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  // A small amount of horizontal scroll is tolerable on mobile; large overflow is not.
  assert.ok(overflow < 100, `Mobile view has ${overflow}px horizontal overflow`);
  assert.deepEqual(runtimeErrors, [], "no JavaScript exceptions in either browser");
  console.log(`Production browser smoke passed: room=${roomCode}; desktop + mobile; horizontal overflow=${overflow}px`);
} finally {
  if (browser) await browser.close();
  child.kill("SIGTERM");
}
