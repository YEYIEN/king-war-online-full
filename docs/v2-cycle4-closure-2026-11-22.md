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

**以上證據不能直接推論兩個 Chromium 頁面已經完整進行至勝者畫面。**

## 第四周目已完成的程式與驗證工作

- 將 V2 起手五張、回合末固定補兩張、超額棄牌、秦始皇三選一與直接選九種魔法同步至測試。
- 修正力量術、燃血術跨回合保留至下一次戰鬥，以及半整備持續到所屬玩家下回合結束。
- 修正斷線或淘汰者兵種未回收的問題，維持共用 60 張兵種牌庫守恆。
- 取得真實 TCP 雙客戶端建房至勝者的自動化成功證據。
- 新增 `tests/v2-full-browser.test.mjs`，要求兩個 Chromium 頁面經由可見 UI 進行至勝者。
- 修復先前不相容的魔法、國王瀏覽器測試腳本；分離 V1 測試，補上 client dependencies、V1 回歸及 build 的 CI 驗證。

## 尚未通過的項目與原因

### P0：雙 Chromium 完整對局（最後驗收目標）

- 新增的 `tests/v2-full-browser.test.mjs` 尚未取得成功的 CI 執行證據。先前網路驗證工作順序將此測試排在國王測試之後，而國王測試先逾時。
- 因此仍不可宣稱完整雙人可玩驗收成功。
- 已將雙 Chromium 完整對局測試排在網路驗證中九種魔法與國王 UI 測試之前（commit `0fabccd1`），以便優先取得關鍵結果。
- 最新 commit 的 Actions 在最後一次檢查時仍 queued；**等待執行屬未確認狀態，並非測試失敗**。

### P1：五位國王瀏覽器測試

- GitHub Actions [44931342354](https://github.com/YEYIEN/king-war-online-full/actions/runs/44931342354) 記錄 `tests/v2-kings-browser.test.mjs:68` 逾時，發生於屋大維流程。
- 原因：UI 要求「超額棄牌 2 張」時，測試腳本固定對所有 prompt 輸入 `1`，導致伺服器拒絕結束回合。這是測試腳本的輸入錯誤，不能由該失敗推斷屋大維實際規則錯誤。
- 已修改為根據 prompt 顯示的超額數量輸入 `1,2,...`（commit `45651eb2`）；新 CI 結果尚未確認。
- 若新測試仍失敗，須查看新堆疊位置與 `#error` 回報，再確認是否另有規則錯誤。

### P1：前端 lockfile 同步

- `client/package.json` 與 `client/package-lock.json` 不一致，使用 `npm --prefix client ci` 曾回報缺少 Supabase 相關套件。
- 第四周目已採 `npm --prefix client install --no-audit --no-fund` 作為 CI 過渡方式，成功完成 V1 回歸及 build。
- 長期正規修正為在受控環境執行 `npm --prefix client install --package-lock-only`，提交並驗證新 lockfile 後重新使用 `npm --prefix client ci`。

### P1：斷線恢復

- V2 玩家識別仍綁定 Socket ID；斷線直接淘汰，尚未實作可恢復遊戲的身份憑證與重新加入流程。
- 需要設計安全的短期重連 token 與伺服器狀態還原，並以「對手無法接管手牌」的安全性測試驗證；未列為本周目的雙人穩定連線垂直切片必要條件。

## 最終分類

- **已驗收：** V2 72/72、TCP 3/3（包含雙人完整伺服器對局）、九魔法雙 Chromium 互動、部署入口 smoke、V1 102/102、前端 build。
- **已修改未驗收：** 屋大維與其他國王 Chromium 測試的棄牌提示修正、完整雙瀏覽器對局測試順序。
- **未完成：** 完整雙 Chromium 從建房到勝者的成功證據、所有五位國王 UI 的通過證據、重連恢復、前端 lockfile 標準化。
- **阻礙：** 最新 GitHub Actions 排隊，尚無實際結果；本機直接複製 GitHub 倉庫時曾遇 DNS 解析問題。

**第四周目依約結案。既有成果保留在 V2 分支；未驗收的完整雙瀏覽器對局不得改寫為已完成。**
