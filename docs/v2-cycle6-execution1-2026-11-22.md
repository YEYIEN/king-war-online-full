# 《國王戰爭》V2｜第六周目第一次開發紀錄

日期：2026-11-22（Asia/Taipei）  
執行次數：**1／5**（已開始）；第六周目未結案。  
基線：`19767136641e3947c5ce094e39e391f3ceaf17a6`。  
第一次功能修改：`0a48032e83dddbe61e1d620300f00511b41afad7`（僅 `server/v2-playtest.html`，沒有修改規則引擎或 `main`）。

## A｜第一批美術概念（真實圖像、非正式卡圖）

本次已在對話交付兩張可檢視的 PNG 圖像：

1. `v2_cycle6_infantry_concept.png`：步兵初級視覺方向；持短劍、藍金盾牌、城堡戰地、動畫風人物，作為三階共用視覺基因的初稿。
2. `v2_cycle6_king_concept.png`：女性化王權角色構圖探索；華麗藍白金鎧甲、王冠與旗幟。**無五位既有國王身分決議**，不可直接命名為正式亞歷山大／屋大維等，也不能自行寫入不在 V2 的光明王等名稱。

**重要限制：** 兩張為圖像生成概念後的構圖裁切，不是純無文字原生分層插畫或正式 63 × 88 mm 的全尺寸成品。原始概念板曾出現未核准國王名稱、HP 30 和虛構兵種能力，**一律不能當成正式規則**；已於可展示角色畫面中避開這些數值。裁切後仍須檢查裝飾性字樣／邊緣；未完成文字與圖片分層、字體排版與印刷出血驗收。

**保存方式：** 此次兩張 PNG 是在當次 ChatGPT 對話生成的附件（本機輸出檔 `/mnt/data/v2_cycle6_infantry_concept.png` 與 `/mnt/data/v2_cycle6_king_concept.png`），**尚未提交為 GitHub 二進位圖檔**，因此不可把本紀錄當成 GitHub 已有美術資產。下次應將最終被挑選的源圖使用支援二進位上傳的工作流程納入專案資產管理，並建立授權／版本紀錄。

## B｜實際 UI 開發

`server/v2-playtest.html` 新增：
- 固定於頁面上方的回合 HUD：自己的回合／等待對手、當前回合、待處理保牌提示與存活玩家數。
- 我方國王名稱和 HP 資訊層級分離、可見操作引導。
- 獨立戰場區及私人手牌區，保留原始 Socket 回呼和既有按鈕 `onclick` 選擇器，降低回歸成本。
- 手機尺寸 CSS、錯誤區塊 `aria-live`。
- **尚未完成：** 用畫面內可點選面板替代 `prompt`／`confirm`、魔法完整 UI、國王能力 UI、三階卡與國王三件套正式排版。

## C｜實測證據與待驗收

- CI [44982508040](https://github.com/YEYIEN/king-war-online-full/actions/runs/44982508040)：`V2 second-cycle acceptance` 整體 success（該次 commit `0a48032e`）。
- CI [44982510883](https://github.com/YEYIEN/king-war-online-full/actions/runs/44982510883)：截至撰寫，`v2-tests` success、`v2-live-smoke` success、`v2-reconnect-browser` 步驟 success；`v2-multiplayer-browser` 執行中，之後完整雙人／魔法／五王瀏覽器回歸仍未完成。不可宣稱整體 workflow 已通過。
- 已驗收的舊版 2–5 人完整瀏覽器回歸仍以第五周目歷史 CI 為證據；**目前新 HUD 最新版整套完整對局尚未驗收**。
- 沒有外網真人試玩或正式 UI 的全部操作驗收；圖片並未進行規則能力文字的正式校對。

## D｜管理分類

- **已驗收：** 基礎 V2 測試、V1 回歸與 build、live smoke、重連瀏覽器步驟（限上述 CI 已成功的測試）。
- **已修改未驗收：** 最新 UI HUD 在 2–5 人完整實際 Chromium 對局下的所有互動。
- **未完成：** 步兵中級與高級概念、三階卡的獨立資訊圖層、國王正式三件套、核心無 prompt UI、前端 lockfile。
- **阻礙：** 新版完整 Chromium 回歸未結束；GitHub 連接器目前僅支援 UTF-8 文字檔建立／更新，無法直接將上述 PNG 提交至 GitHub，故圖像先作為對話附件交付。
