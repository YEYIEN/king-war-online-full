# 《國王戰爭》V2｜第五周目正式結案報告

**結案日期：** 2026-11-22（Asia/Taipei）  
**周目狀態：** 第 5 次開發對話，**正式結案，不展延**  
**開發分支：** `rules-v2-tabletop-rebuild`  
**最後功能提交基準：** `460ecafb63196202a0f0c6e27bffa323500b1545`  
**最後一份結案前驗收紀錄：** `c2c8521266c898d0b591aa564b1c193132b59c83`  
**結論：部分達標；2–5 人可玩垂直切片已驗收，安全重連的基本流程已驗收，但第五周目完整工程與產品驗收未達標。**

## 一、周目原訂交付與達成判定

| 第五周目目標 | 結果 | 證據／界限 |
|---|---|---|
| 清除五位國王瀏覽器驗收阻斷 | 已驗收（指定情境） | `ff7e64d7`、Actions [44932890047](https://github.com/YEYIEN/king-war-online-full/actions/runs/44932890047)：五位國王 Chromium 測試通過 |
| 2–5 人從建房到勝者的完整瀏覽器對局 | 已驗收（指定情境） | `ff7e64d7`、Actions [44932890047](https://github.com/YEYIEN/king-war-online-full/actions/runs/44932890047)：3、4、5 人與雙人完整對局 Chromium 測試全部成功，測試包含私有手牌檢查 |
| 九種魔法的雙瀏覽器可操作性 | 已驗收（指定情境） | `ff7e64d7`、Actions [44932890047](https://github.com/YEYIEN/king-war-online-full/actions/runs/44932890047)：九種魔法瀏覽器測試成功 |
| 安全重連、恢復原手牌、避免舊 Socket 與憑證冒用 | 基礎流程已驗收 | 最後功能版本 `460ecafb`；Actions [44981634451](https://github.com/YEYIEN/king-war-online-full/actions/runs/44981634451)：V2 78/78、Chromium 重連測試步驟成功；包含手動斷線後重新整理及直接重新整理兩種路徑 |
| 斷線逾時淘汰、舊憑證失效、保牌紀錄計次維持 | 已驗收（單元情境） | `server/rules-v2-reconnect.test.mjs` 六個情境納入 V2 78 項成功測試；非真實外網／高並發的廣泛安全證明 |
| 最新功能版本 2–5 人、九魔法、五王全部 Chromium 回歸 | **未完成最新驗收** | 最後檢查時 `460ecafb` / `c2c85212` 的 `v2-network` 工作仍在執行 3–5 人完整瀏覽器測試，後續測試尚未到達。先前成功版本仍有獨立證據，但不可挪用為新版本整套通過 |
| 基本多人 UI 不依賴原生 prompt | **未完成** | V2 測試入口仍有 prompt／confirm 操作。需改為遊戲內可點選的目標、超額棄牌及能力互動 UI |
| `client/package-lock.json` 與 `package.json` 同步並恢復 `npm ci` 可重現安裝 | **未完成** | V2 CI 目前仍以 `npm --prefix client install` 過渡，不得稱為 lockfile 問題已解決 |
| 跨部署的對局持久化、真實外網玩家試玩 | **未完成** | 現階段短期重連保持在單程序記憶體；伺服器重啟仍會失去 V2 房間狀態。沒有外網多人手動驗收紀錄 |

## 二、最後功能版本的實際執行證據

在 commit `c2c85212` 的 CI：

1. Actions [44981630654](https://github.com/YEYIEN/king-war-online-full/actions/runs/44981630654) 整體 **success**：
   - `npm run test:v2`：**78 tests / 78 passed / 0 failed**。
   - `npm test`：**102 tests / 102 passed / 0 failed**。
   - `npm run build`：**success**（Vite built in 233 ms）。
2. Actions [44981634451](https://github.com/YEYIEN/king-war-online-full/actions/runs/44981634451) 最後查詢時：
   - `v2-tests` job 成功。
   - `v2-live-smoke` job 成功。
   - `node --test tests/v2-reconnect-browser.test.mjs` 步驟成功。
   - `node --test tests/v2-multiplayer-browser.test.mjs` **仍在執行**；其後完整雙人、魔法、五王 Chromium 步驟仍待執行。
   - **整體 run 尚未完成，不能標記為 success。**
3. 在前一個可比對的提交 `ff7e64d7`，Actions [44932890047](https://github.com/YEYIEN/king-war-online-full/actions/runs/44932890047) 全部 V2 工作成功，提供 2–5 人完整對局、魔法、五王的瀏覽器驗收基準。這不是新重連版本的完整回歸結果。

**驗收證據分層：** 規則單元成功 ≠ 真正多瀏覽器實玩成功 ≠ 真實外網跨裝置驗收 ≠ 生產環境與資安完整驗收。

## 三、第五周目完成的實際程式變更

- 修正 `tests/v2-kings-browser.test.mjs` 的屋大維平手防守情境：攻擊方先前自動接受亞歷山大的戰力 +1，導致測試的相等戰力前提失效。
- 新增 `tests/v2-multiplayer-browser.test.mjs`，驗證 3、4、5 名玩家各自以獨立 Chromium 由房間建立進行至唯一勝者，檢查各玩家私有手牌。
- 在 `server/v2-playtest-socket.mjs` 增加短期恢復憑證、每次恢復後輪替 token、保留原手牌和回合、逾時淘汰；拒絕過期與重放憑證。
- 在 `server/v2-playtest.html` 使用同分頁 sessionStorage 保留並更新恢復資訊；重連與頁面重新整理後可嘗試恢復座位。
- 將保牌計次對象由舊 Socket ID 轉移至新 Socket ID，避免玩家透過斷線重連重設保牌配額。
- 處理「直接重新整理、舊 Socket 尚未收到斷線事件」的競態：有有效 token 的新連線可原子接管座位，舊連線權限撤銷且遲到的舊斷線事件不再淘汰新連線。
- 新增 `server/rules-v2-reconnect.test.mjs` 與 `tests/v2-reconnect-browser.test.mjs`，將安全性與真實瀏覽器重連列入持續驗證。
- 在 `d5009615` 曾誤把 `previousId` 放入普通 `v2:join` 處理器，造成明確的回歸失敗；已於 `460ecafb` 修復，後續 V2 78/78 與新一輪重連瀏覽器步驟成功。

## 四、未完成原因、風險與後續解決方式

### P0：最新版本整套 Chromium 回歸尚未完成

**原因：** GitHub Actions `v2-network` 順序執行多個耗時的真實 Chromium 測試；截至結案查詢，3–5 人測試仍在執行，後續雙人、魔法與五王尚未開始。**等待不等同失敗，無須虛構程式修正。** 在 CI 完成前，不允許宣稱最新版本所有對局流程都已驗收。

**下一階段核對：** 閱讀該 run 每個步驟結果與日誌；若出現確定失敗，先判定是否與重連競態或 UI 測試腳本相關，再最小化修正與重測。

### P1：原生 prompt／confirm 仍為主要操作流程

**原因：** 第五周目優先用於多人完整對局與重連權威狀態，未完成全面 UI 重製。

**後續解法：** 以遊戲內可選目標列、手牌棄置勾選、魔法／國王能力面板取代輸入數字，配合 320–430px 與桌面瀏覽器測試；不得因裝飾犧牲回合、HP、目標、手牌等可讀性。

### P1：client lockfile 不一致

**原因：** `client/package-lock.json` 未與當前 package manifest 同步，前一周目曾在 `npm --prefix client ci` 失敗，因此暫時使用 install。

**後續解法：** 受控環境更新鎖定檔，提交後在乾淨機器驗證根目錄及 client 的 `npm ci`、`npm test`、`npm run test:v2`、`npm run build`。在成功前不更換既有 CI 安裝流程。

### P0（對外營運階段）：跨伺服器重啟恢復

**原因：** V2 room state 仍為記憶體 Map，短期重連只保證同一程序尚存活時可以回復。

**後續解法：** 設計安全持久化（伺服器權威私有牌、回合、pendingAttack、身份憑證），驗證版本遷移、重啟後繼續、雙連線接管、無明文憑證記錄與回滾。此功能未在第五周目完成。

### 尚未完成真實玩家驗收與正式美術

**原因：** 目前證據來自 CI 的自動化 Chromium，尚未由真人使用不同設備與外網完成封閉測試；國王立繪＋選擇卡＋戰場資訊框樣板仍未正式交付。

**後續解法：** 先清除技術回歸再進入封閉試玩與一名國王美術樣板，逐項驗證再擴展。正式入口與 V1 在新 V2 驗收通過前保留。

## 五、最終交付分類與結論

- **已驗收：** 原有 2–5 人完整 Chromium 對局、五位國王 UI 情境、九魔法 UI 情境；最新版 V2 **78/78**、V1 **102/102**、build、live smoke、雙 Chromium 安全重連步驟。
- **已修改未完全驗收：** 最新重連版本下的整套 2–5 人、九魔法、五王瀏覽器回歸，尚待同一次 CI 完成；僅能標記「部分步驟通過」。
- **未完成：** 正式多人互動 UI、client lockfile 修復、真實外網玩家實玩與裝置兼容、跨部署安全恢復、完整美術樣板及正式發布準備。
- **阻礙：** GitHub Actions 長時間 Chromium 回歸尚在執行；目前不應編造失敗原因或標記 success。
- **版本安全：** `main` 與正式 V1 未修改、未刪除，V2 使用獨立 namespace 與測試入口，回復途徑仍在。

**第五周目於第五次開發對話正式結案，判定「部分達標」；不將剩餘工作帶回本周目，也不以未來承諾代替本次交付。**
