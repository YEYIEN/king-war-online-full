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
