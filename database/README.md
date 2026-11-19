# 帳號與資料庫整合（零新增付費預算）
目前第一階段「遊客重新連線與五分鐘逾時」已直接整合至 Render Socket.IO 伺服器。
此資料夾是第二階段的 **準備用結構**，尚未啟動 Google 登入、長期戰績或跨裝置帳號恢復。

## 需要操作的步驟（均可使用免費層）
1. 在 Supabase 建立 Free 專案，確認資料保存／暫停／免費用量限制。
2. 在 Supabase SQL Editor 執行 `schema.sql`。
3. 在 Google Cloud 建立 OAuth Web Client，設定正式網站來源和 Supabase 的 Redirect URI。
4. 在 Supabase Auth 設定 Google Provider；日後將匿名身分升級時需檢查 identity linking 規則。
5. 應用程式需接入 `@supabase/supabase-js`、後端驗證 JWT、建立帳號→房間權限映射，避免只根據 email 或未驗證的 userId 控制角色。
6. 遊戲伺服器寫入對局快照時需加密、採版本／時間戳以及原子更新，並在重啟時恢復。
7. 私密金鑰只放 Render 環境變數；**絕對不要放 VITE_ 前綴的環境變數或 GitHub 原始碼**。
8. 部署前完成匿名玩家、Google 玩家、跨裝置、五分鐘判負、並發登入、伺服器重啟和刪除資料測試。

## 此方案的安全邊界
- Supabase Auth 用於辨認使用者；Render 仍為戰鬥判定的唯一權威。
- `active_matches` 為伺服器專用且必須加密，不能對一般使用者授予 SELECT。
- RLS 只讓玩家查閱自己的 profile、參戰紀錄與 active-match membership。
- 保留現有遊客流程，即使尚未設定 OAuth 也能開房及重連。
- 不要因為建立了 schema，就宣稱帳號服務已經開通。
