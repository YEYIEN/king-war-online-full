# 國王戰爭 Online Full v2 with New Card Images

這是《國王戰爭》線上版 v2，已整理新版卡圖素材並放入：

```text
client/public/king-war-assets/cards
client/public/king-war-assets/kings
client/public/king-war-assets/rules
```

本包保留線上多人架構，可建房、加房、隱藏手牌、同步遊戲狀態。

另外也放入你提供的程式碼：

```text
client/src/App_v7_magic_nerf_multi_confirm.jsx
App_v7_magic_nerf_multi_confirm.jsx
```

## 本機測試

```powershell
cd C:\Users\yeyua\king-war-project\king-war-online-full-v2-with-new-card-images
npm.cmd install
cd client
npm.cmd install
cd ..
npm.cmd run dev
```

開啟：

```text
http://localhost:5173
```

## Render 部署

Build Command:

```bash
npm install && cd client && npm install && npm run build
```

Start Command:

```bash
npm start
```

## 圖片說明

新版圖片已依程式讀取路徑重新命名，例如：

```text
/king-war-assets/cards/初級步兵_63x88mm_300dpi.png
/king-war-assets/cards/火球術_63x88mm_300dpi.png
/king-war-assets/kings/亞歷山大大帝.png
```

缺少重新生成的「天殞術」暫時沿用舊版素材，以避免遊戲出現破圖。


## v2 重新打包內容

本版已將 `App_v7_magic_nerf_multi_confirm(3).jsx` 設為主要前端程式碼，並整理所有新版圖片到：

- `client/public/king-war-assets/cards`
- `client/public/king-war-assets/kings`
- `client/public/king-war-assets/rules`

已補入新版 `天殞術_63x88mm_300dpi.png`。


## v3 Online Multiplayer

這版已恢復多人連線入口 `client/src/main.jsx`，並保留新版圖片素材。

主要檔案：
- `server/index.js`：線上房間、牌堆、手牌隱藏、戰鬥與魔法規則
- `client/src/main.jsx`：多人線上版前端
- `client/src/App_v7_hotseat_reference.jsx`：你上傳的單機熱座版程式碼參考
- `client/public/king-war-assets`：新版卡圖與規則圖

本機測試：

```powershell
npm.cmd install
cd client
npm.cmd install
cd ..
npm.cmd run dev
```

部署 Render：

Build Command:
```bash
npm install && cd client && npm install && npm run build
```

Start Command:
```bash
npm start
```


## 2026-11 — 部署前驗收與安全依賴（修復分支）

本專案使用 Node.js 24、Express/Socket.IO 與 Vite 8。根目錄及 `client/` 具有獨立鎖定檔，部署時請使用 `npm ci`，避免安裝不一致的依賴版本。

### Render 設定（同一個 Node Web Service）

- Repository: `YEYIEN/king-war-online-full`
- Root directory: repository root (leave blank)
- Runtime: Node
- Build Command: `npm ci && npm --prefix client ci && npm run build`
- Start Command: `npm start`
- Environment variable: `NODE_VERSION=24`（若服務未使用其他方式固定版本）
- Health check path: `/`

正式伺服器在 `NODE_ENV=production` 下提供 `client/dist` 的靜態檔與 Socket.IO。同一個服務處理前端網頁及 WebSocket，不需要另開靜態站點。此階段**未直接操作 Render**；上述指令依 GitHub Actions 的正式模式建置／瀏覽器測試驗證，不等同 Render 上線實測。

### 自動驗收

`npm test` 涵蓋房間、施法、AI、回合移交及完整雙人勝負流程。GitHub Actions 另外安裝 Playwright Chromium，執行 `node scripts/production-browser-smoke.mjs`，在正式模式下檢查：

- 桌面版建立私人房間
- 手機尺寸訪客加入、按下準備、開始遊戲
- JavaScript 未捕捉例外與手機橫向溢位
- npm audit 的前後端依賴安全公告

真實 Android/iOS 裝置、不同瀏覽器及 Render 服務上的雙人實測仍須另外驗收。原本舊版 `kw_session` 沒有恢復憑證，更新後需重新加入新的房間。
