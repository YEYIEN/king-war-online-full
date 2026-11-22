# 《國王戰爭》V2 第七周目正式結案報告

**結案日期：** 2026-11-22（Asia/Taipei）  
**周目進度：** **5/5，正式結案；不展延、不以「下次繼續第七周目」代替驗收。**  
**開發分支：** `rules-v2-tabletop-rebuild`；`main`、正式 V1 與正式入口未切換。  
**最後一次當次主要修正：** `72c5086aa6e6d37d2e312a409b79c46c2e062788`（修正 client lockfile）；`d5d2d6a4afa81c02c6bef2a97ffbf86039224391`（乾淨 npm ci／build CI）。  
**結案結論：功能部分達標，但 **未達第七周目既定「全部 P0 完成並凍結」門檻，Go/No-Go = **NO-GO**；第八周目目前不能直接聲稱「只做收尾驗收」。**

## 一、計畫對照：哪些完成、哪些未完成

| 第七周目既定交付 | 已取得的實際證據與真實狀態 | 結案判定 |
|---|---|---|
| 可視化部署、攻擊、國王傷害、回合棄牌 | `#tactic-choice`、`#end-choice` 已實作，雙 Chromium 完整對局測試在前版 CI success | **已驗收指定版本**，最新提交仍待回歸 |
| 九魔法頁面內施法與目標 | `#magic-choice` 已實作，九魔法雙 Chromium 指定情境 success | **已驗收指定版本**，最新提交待回歸 |
| 五王能力與既有規則回歸 | 五王原有瀏覽器 regression success；亞歷山大／成吉思汗／路易十四、秦始皇各有可視化路徑，屋大維為被動 | **指定情境成功**，未完成全部新 UI 組合驗收 |
| 2 人從建房至勝者、私有手牌 | `v2-full-native` 在指定分支版本 success，有零原生彈窗與勝者一致性斷言 | **已驗收指定版本** |
| 3、4、5 人最新完整新 UI | 舊串行 3 人／4 人 success；五人曾於 240s timeout 後才記錄完成 20 次對王攻擊；改為 420s，**新版本沒有全套成功證據** | **P0 未驗收** |
| 預設客戶端無 prompt | 普通入口已只顯示新可點選按鈕，歷史 `?legacy=1` 模式保留舊函式；新增預設入口零舊按鈕斷言 | **已修改，最新版待驗** |
| 根與 client 可重現乾淨 `npm ci` | 本次按 GitHub Actions 真實 npm 生成檔，修復 `client/package-lock.json`；新增雙環境 `npm ci`／build 工作流 [44993207009](https://github.com/YEYIEN/king-war-online-full/actions/runs/44993207009) | **已修復鎖定資料，乾淨 CI 尚未驗收** |
| 60 秒重連、token 輪替、私有手牌 | 既有同程序 Chromium／Socket 測試 success | **同程序重連已驗收** |
| 服務重啟後恢復房間／私有牌局 | 仍為單程序記憶體房間，沒有已驗收的跨重啟資料儲存與恢復 | **P0 未完成** |
| 十二張兵種階級美術真正載入 | `docs/v2-unit-art-manifest.json` 完成 12 個 ID，**全部標記 `NOT_IN_REPOSITORY`**；V2 僅有資料標記與圖示 | **P0 未完成** |
| 一位國王的立繪、選王卡、戰場資訊框 | 尚未有完成並核准的三件套在遊戲內整合 | **P0 未完成** |
| 真人外網多設備完整對局與部署演練 | 未取得真人跨設備全局驗收 | **未完成／非自動測試可替代** |

## 二、真正的正向證據（不得擴大解讀）

- [V2 rule validation 44990900434](https://github.com/YEYIEN/king-war-online-full/actions/runs/44990900434)，關鍵 jobs 已完成 **success**：`v2-full-native`（雙人完整新 UI）、`v2-magic-native`（九魔法可視化）、`v2-network`（既有五王、魔法、重連、手機等）、`v2-tests`（規則）與 `v2-live-smoke`。在該次查詢時 `v2-multiplayer-native` 仍 `in_progress`；這不能稱整個工作流已全部通過。
- [V2 rule validation 44990769342](https://github.com/YEYIEN/king-war-online-full/actions/runs/44990769342) 的真實日誌：3 人約 94s pass，4 人約 159s pass，5 人 240s **timeout 並取消**，之後輸出五人 20 次對王攻擊的完成訊息。**該次五人測試不算通過**；提高測試時限至 420s 是根據證據的最小修正，不是遊戲功能驗證。
- [V2 second-cycle acceptance 44992284381](https://github.com/YEYIEN/king-war-online-full/actions/runs/44992284381) 在第 4 次文件提交版 success，代表該工作流要求的基礎 V1／V2／build 工作成功，**不是跨重啟和完整 2–5 人新 UI 一次驗收**。
- [V2 client lockfile refresh evidence 44992175631](https://github.com/YEYIEN/king-war-online-full/actions/runs/44992175631) success：Node 24 npm 重新生成前端 lockfile；本次從其完整可核對的日志重組 lockfile，驗證 `client/package.json` 所列直接依賴均一致且 `node_modules/@supabase/supabase-js` 存在，後提交 `72c5086a`。**有完整依賴紀錄仍需要乾淨 `npm ci` 通過才能算安裝驗收**。
- [Release readiness 44992287937](https://github.com/YEYIEN/king-war-online-full/actions/runs/44992287937) 的 `security-and-tests` job **failed at dependency install**；這是發行準備未通過，不等同 V2 規則錯誤；但也不能掩蓋工程阻斷。
- 最後一次的 [V2 clean dependency install gate 44993207009](https://github.com/YEYIEN/king-war-online-full/actions/runs/44993207009) 剛建立時 **queued**，尚未有正確的 `npm ci` 和 `build` 成功證據。

## 三、第七周目五次實作成果

1. **1/5：** 加入頁面內戰術攻擊與成吉思汗／路易十四操作面板、12 張兵種資產 ID 合約與 Chromium 指定情境。
2. **2/5：** 九魔法全部以頁面內施法、法師／玩家／目標選擇，補九魔法雙 Chromium 測試；自選我方魔法不再要求使用者點無關敵人。
3. **3/5：** 全局 2–5 人新 UI 無彈窗測試，將雙人、3–5 人、九魔法 Chromium 獨立並行 CI，早發現 P0。
4. **4/5：** 預設 V2 入口隱藏舊 prompt 操作，舊版僅在 `?legacy=1`；修改攻擊狀態競態，根據日誌修正五人測試時限；定位 client lockfile 缺件。
5. **5/5：** **當次完成實際 lockfile 修復寫回**（12 張圖資仍未實作），並新增 `npm ci`＋build 獨立乾淨安裝門檻；當次出具正式 NO-GO 結案報告。

**工程路徑不變**：以 V2 開發分支為唯一修改對象，正式 V1／`main` 不切換。保留前一個可回復提交 `c9dfa1cdb3fefabaf24cd42dc9f91d73fe42bb95`；本次兩個實作提交 `72c5086a`、`d5d2d6a4` 是附加在其後，可按提交回復，不擅自刪 V1。

## 四、正式四分類

**已驗收：**
- 指定較早提交的雙 Chromium 完整兩人對局、九魔法可視化、五王回歸、V2 規則與既有重連及行動 HUD。
- Node 24 使用 npm 真實重新生成的 client lockfile 已從工作日誌完整取回、經直接依賴與 Supabase 節點存在性核對，並成功寫入開發分支；**此項的提交驗證並非乾淨安裝通過**。

**已修改未驗收：**
- 最新版本預設無彈窗 V2 UI、五人 420s 全局回歸、根及 client 新 `npm ci`／build CI；最新 GitHub Actions 排隊，無法聲稱通過。
- 前端修正後的 release readiness 工作流也需重跑判定；不提前宣稱安全、負載或發行門檻通過。

**未完成：**
- 服務重新啟動後可安全恢復房間與私有手牌（跨程序持久化）。
- 12 張真正可讀取的兵種卡面（四兵種三階的不同人物）與一位核准國王三件套；現有 manifest 都未入庫。
- 最新 2–5 人同一版本的完整無原生彈窗 CI 成功證據、真人外網多裝置試玩。
- 所有正式發行安全、營運與渠道上架驗收。

**阻礙：**
- 不是只有 GitHub Actions 排隊，而是持久化與美術資產仍缺實作；它們是獨立 P0，不能用測試成功證據替代。
- 當前 CI 並行數量多，部分完整多人測試耗時超過 4 分鐘；需要觀察最新獨立 jobs 的真實成功／失敗再裁定。
- 不得擅自使用新的付費資料服務或刪除正式 V1。

## 五、第八周目接手建議與必須先面對的決策

**依第七周目最初訂立的 Definition of Done：本次結案為 NO-GO，不能把第八周目說成「只剩驗收」。**

若第八周目要維持純驗收，必須先取得滿足全部 P0 的候選版；然而現況並未具備。下一步應**先向使用者明確揭露範圍差距**，由使用者選擇：
- **A. 堅守原 P0：** 先補跨重啟持久化與十二張已載入卡圖／國王套件，再進入真正 QA 周目（會使原先第八周目定位需要調整）。
- **B. 限縮封閉測試候選版：** 在明確同意「單程序重啟丟失對局」「未完成美術」與公開警語的前提下，保留 V1，不做正式公開發行，只做限時技術型多人測試驗收；其成功不能被記為原計畫 P0 已完成。
- **C. 專案暫停：** 保留 `rules-v2-tabletop-rebuild` 與所有成功測試證據，暫緩使用未獲批准的發布功能與費用。

**無論採何方案，不能擅自改 `main`、正式入口、V1、已核准遊戲規則或開通付費服務。**

## 六、硬性結案聲明

**第七周目共 5 次開發對話已使用完畢、正式結束。第 5 次的結案報告已直接存入 GitHub。**  
不能把目前不達標稱為成功完成；不能因 CI 事後通過就追認持久化、美術或真人實玩已存在；下個周目需要依本結案報告重新判定驗收範圍。
