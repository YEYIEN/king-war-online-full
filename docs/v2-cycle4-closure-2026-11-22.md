# 國王戰爭 V2｜第四周目結案報告

日期：2026-11-22（Asia/Taipei）  
分支：`rules-v2-tabletop-rebuild`  
結論：**階段性進展成立，完整驗收尚未達標；依最後期限結案。**  
保護措施：未修改 `main`、未移除 V1、未切換正式入口。

## 已取得的實際證據（commit `0a2add64`）

1. `npm run test:v2`：**72 passed, 0 failed**；GitHub Actions [44931342354](https://github.com/YEYIEN/king-war-online-full/actions/runs/44931342354)，其 `v2-tests` job 成功。
2. 實際 TCP Socket.IO：**3 passed, 0 failed**。包含兩個獨立 Socket.IO 客戶端從建立房間直到 HP 歸零、雙方取得相同勝者；同一 workflow 的 `v2-network` job 中此步驟成功。
3. 九種魔法透過兩個真實 Chromium 頁面操作：**1 passed, 0 failed**（九種魔法皆在單一迴圈式測試內通過）；同一 `v2-network` job 中相應步驟成功。
4. 已部署測試入口之雙瀏覽器建房、部署與回合切換 smoke test：**1 passed, 0 failed**；同一 workflow 的 `v2-live-smoke` job 成功。
5. `npm test`（V1 回歸）：**102 passed, 0 failed**；`npm run build` 成功（Vite built in 223 ms）；GitHub Actions [44931336223](https://github.com/YEYIEN/king-war-online-full/actions/runs/44931336223)，整體 success。

**追加驗收（commit `0fabccd1`）：** [GitHub Actions 44931807155](https://github.com/YEYIEN/king-war-online-full/actions/runs/44931807155) 中 `tests/v2-full-browser.test.mjs` **成功**，兩個真實 Chromium 頁面從建房至雙方顯示一致勝者，且驗證對手手牌隱藏；`tests/v2-magic-browser.test.mjs` 亦 **成功**，九種魔法 UI 走查通過。同一流程的五位國王瀏覽器測試仍失敗，整體 workflow 因此呈現 failure，不能將它描述為所有關卡通過。

## 第四周目已完成的程式與驗證工作

- 將 V2 起手五張、回合末固定補兩張、超額棄牌、秦始皇三選一與直接選九種魔法同步至測試。
- 修正力量術、燃血術跨回合保留至下一次戰鬥，以及半整備持續到所屬玩家下回合結束。
- 修正斷線或淘汰者兵種未回收的問題，維持共用 60 張兵種牌庫守恆。
- 取得真實 TCP 雙客戶端建房至勝者的自動化成功證據。
- 新增 `tests/v2-full-browser.test.mjs`，要求兩個 Chromium 頁面經由可見 UI 進行至勝者。
- 修復先前不相容的魔法、國王瀏覽器測試腳本；分離 V1 測試，補上 client dependencies、V1 回歸及 build 的 CI 驗證。

## 尚未通過的項目與原因

### P0：雙 Chromium 完整對局（最後驗收目標）

- **已取得自動化雙 Chromium 完整對局成功證據**：兩頁經可見 UI 完成從建房到勝者顯示，且兩方同意勝者。
- 該證據覆蓋一組決定性情境；尚不等同涵蓋所有國王、法術、重連及多人操作組合。
- 已將雙 Chromium 完整對局測試排在網路驗證中九種魔法與國王 UI 測試之前（commit `0fabccd1`），以便優先取得關鍵結果。
- 關鍵完整瀏覽器對局在 commit `0fabccd1` 的 Actions 已成功；最後的國王 UI 測試未通過，故該 workflow 整體為 failure。

### P1：五位國王瀏覽器測試

- GitHub Actions [44931342354](https://github.com/YEYIEN/king-war-online-full/actions/runs/44931342354) 記錄 `tests/v2-kings-browser.test.mjs:68` 逾時，發生於屋大維流程。
- 第一個錯誤是超額棄牌 prompt 固定輸入 `1`；已修為依數量輸入 `1,2,...`（commit `45651eb2`），因此原本在第 68 行的結束回合逾時不再重現。
- 後續 CI [44931807155](https://github.com/YEYIEN/king-war-online-full/actions/runs/44931807155) 在 **`tests/v2-kings-browser.test.mjs:71`** 仍逾時：屋大維情境的攻擊者兵種未在期待時間內變為 0 張。**真正原因尚未定位**：可能是伺服器拒絕攻擊、測試初始卡組與預期不一致或戰鬥規則結果不同，不能直接猜測。
- 具體解法：在該攻擊操作後同時輸出兩頁的 `#error`、`state.players[*].field`、國王種類、當前回合與最新 `log`，再比對 `resolveBattle` 的戰力及屋大維相等防守特例；據實際差異修正測試資料或遊戲邏輯，重跑單項瀏覽器測試。

### P1：前端 lockfile 同步

- `client/package.json` 與 `client/package-lock.json` 不一致，使用 `npm --prefix client ci` 曾回報缺少 Supabase 相關套件。
- 第四周目已採 `npm --prefix client install --no-audit --no-fund` 作為 CI 過渡方式，成功完成 V1 回歸及 build。
- 長期正規修正為在受控環境執行 `npm --prefix client install --package-lock-only`，提交並驗證新 lockfile 後重新使用 `npm --prefix client ci`。

### P1：斷線恢復

- V2 玩家識別仍綁定 Socket ID；斷線直接淘汰，尚未實作可恢復遊戲的身份憑證與重新加入流程。
- 需要設計安全的短期重連 token 與伺服器狀態還原，並以「對手無法接管手牌」的安全性測試驗證；未列為本周目的雙人穩定連線垂直切片必要條件。

## 最終分類

- **已驗收：** V2 72/72、TCP 3/3（包含雙人完整伺服器對局）、雙 Chromium 完整對局至勝者、九魔法雙 Chromium 互動、部署入口 smoke、V1 102/102、前端 build。
- **已修改未驗收：** 五位國王 Chromium 情境（屋大維戰鬥斷言失敗）、用以保證穩定重連的機制。
- **未完成：** 所有五位國王 UI 的完整通過證據、重連恢復、前端 lockfile 標準化、更多多人與魔法組合實玩驗收。
- **阻礙：** 屋大維瀏覽器戰鬥測試仍失敗（需新增狀態診斷才能定位）；本機直接複製 GitHub 倉庫時曾遇 DNS 解析問題。

**第四周目依約結案。核心雙瀏覽器對局垂直切片已有成功證據，但五位國王 UI 全面驗收未達標，因此第四周目仍判定未完全達標。**
