# 國王戰爭 V2｜第五周目驗收紀錄（第 4 次執行）

日期：2026-11-22（Asia/Taipei）  
開發分支：`rules-v2-tabletop-rebuild`  
狀態：**第五周目尚未結案**；本文件是已建立的驗收紀錄，最終結論需以第 5 次執行的實際測試結果更新。不得將未通過的 CI 或功能視為成功。

## 已驗收的基準

- GitHub Actions [44932890047](https://github.com/YEYIEN/king-war-online-full/actions/runs/44932890047) （commit `ff7e64d7`）：V2 核心測試成功；真實 3、4、5 人 Chromium 完整對局成功；雙 Chromium 2 人完整對局成功；九種魔法瀏覽器操作成功；五位國王瀏覽器操作成功；V2 live smoke 成功。
- GitHub Actions [44932884511](https://github.com/YEYIEN/king-war-online-full/actions/runs/44932884511) （commit `ff7e64d7`）：V1 回歸測試與 frontend build 成功。
- GitHub Actions [44981077656](https://github.com/YEYIEN/king-war-online-full/actions/runs/44981077656) （commit `460ecafb`）：V1 / V2 相關測試與 frontend build 工作流程成功。
- GitHub Actions [44981081125](https://github.com/YEYIEN/king-war-online-full/actions/runs/44981081125) （commit `460ecafb`）：V2 tests、V2 live smoke 與 real Chromium reconnect browser 測試步驟成功；同一流程在本文件建立時，長時間多人、魔法、五王 UI 回歸**仍執行中**，不可宣稱整個工作流程已通過。
- 上述通過的是特定自動測試情境，不等同真實使用者於不同裝置與外部網路的手動試玩，也不等同正式 Render 生產環境驗收。

## 本周目功能與問題紀錄

### P0：完整 2–5 人對局

- 已完成 2、3、4、5 個獨立 Chromium 用戶端建立／加入房間，部署，回合切換，對國王攻擊，淘汰及共同顯示勝者。
- 已在每位玩家觀點驗證手牌僅本人可見；此為特定自動測試下的權威狀態保密證據。
- 將持續以 `tests/v2-multiplayer-browser.test.mjs` 和 `tests/v2-full-browser.test.mjs` 驗證每次伺服器變動不造成回歸。

### P0：五位國王、九種魔法

- `tests/v2-kings-browser.test.mjs`：五王互動測試於 `ff7e64d7` 通過。先前屋大維失敗根因為測試預設接受亞歷山大的 +1 戰力加成，導致不再是相等戰力；已修正測試操作。
- `tests/v2-magic-browser.test.mjs`：九種魔法透過實際雙 Chromium 操作於 `ff7e64d7` 通過。
- 尚未涵蓋所有國王 × 魔法 × 多人極端交互情境。

### P0：安全斷線重連

- V2 獨立 namespace 新增短期恢復憑證、重新綁定 Socket 身分、旋轉憑證、保留手牌／場上狀態與限時淘汰。
- `server/rules-v2-reconnect.test.mjs` 涵蓋合法恢復、拒絕無效與過期 token、避免舊連線繼續操作、保牌計次紀錄轉移、逾時回收牌、仍在對局中的三人逾時淘汰，以及舊連線尚未收到 disconnect 前的原子接管。
- `tests/v2-reconnect-browser.test.mjs` 涵蓋斷線後重新整理並恢復手牌，以及未先手動斷線直接重新整理的接管。
- 在 `d5009615` 修正中曾錯把 `previousId` 處理插入 `v2:join`，導致加入房間回歸失敗；`460ecafb` 已限定原子接管於 `v2:resume`，V2 規則測試已通過。
- 未驗收：外網真實斷線／切換行動網路、多分頁及跨裝置策略、伺服器重啟後恢復、長時間離線情境、真實並發壓力測試。

### P1：工程與前端

- 根目錄 V1 測試與 V2 測試已隔離。
- `client/package-lock.json` 仍須與 `client/package.json` 同步，重新驗證 `npm --prefix client ci`。
- 目前 V2 UI 仍使用瀏覽器 `prompt` 處理部分棄牌、國王能力和魔法指定，應改為明確可用的遊戲介面；正式國王美術樣板尚未完成。

## 第五周目目前驗收分類

**已驗收：** 以 `ff7e64d7` 為基準的 2–5 人雙／多 Chromium 完整對局、五王 UI、九魔法 UI；以 `460ecafb` 為基準的 V2 核心規則測試、live smoke、重連瀏覽器步驟、V1 回歸與 build。

**已修改未完全驗收：** `460ecafb` 版本的 2–5 人完整對局、九魔法與五王瀏覽器回歸工作流程（當下執行中）。

**未完成：** 真實使用者跨裝置試玩、可靠跨部署恢復、正式操作 UI、前端 lockfile 的 `ci` 重現性、正式部署驗收。

**阻礙：** 長時間 Chromium 回歸尚在 GitHub Actions 執行中，沒有新失敗證據前無需虛構解法。

## 管理與版本保護

- 本周目開發對話 4/5。第 5 次執行須優先收集新 CI、解決阻斷回歸並直接交付**第五周目正式結案報告**，即使未達標仍需結案。
- `main` 與正式 V1 未修改，未切換正式入口，保持回復途徑。
- 本文件本身是正式版本化驗收紀錄，不冒充整周目已結案。
