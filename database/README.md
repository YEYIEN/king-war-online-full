# 《國王戰爭》Supabase 專案與帳號整合

## 已建立（2026-11-19）
- Supabase 組織：YEYIEN's Org
- 專案名稱：king-war-online
- Project ref：`xhtkcuuaqgihlduasnqn`
- 區域：東京（`ap-northeast-1`）
- 專案網址：`https://xhtkcuuaqgihlduasnqn.supabase.co`
- 建立時的報價：US$0／月（保持免費方案，不增購付費項目）
- 資料庫狀態：ACTIVE_HEALTHY
- 已執行 `database/schema.sql`：五張表已成功建立且啟用 RLS。

### 已建立資料表
| 資料表 | 用途 | 前端存取 |
| --- | --- | --- |
| player_profiles | 玩家暱稱與帳號資訊 | 只能讀寫自己的資料 |
| match_history | 已結束的對戰摘要 | 只能讀自己參與的對局 |
| match_participants | 個人戰績、使用國王 | 只能讀自己的參賽資料 |
| active_matches | 加密完整對局快照 | 不允許瀏覽器直接讀寫 |
| active_match_members | 用戶與進行中房間的映射 | 只能讀自己的映射 |

Supabase Security Advisor 回報 `active_matches`「RLS enabled no policy」資訊項目；**這是刻意設計**，因為完整對戰狀態、手牌、牌庫不可對任何普通客戶端開放讀取。未設定任何客戶端可讀寫規則。

## 尚未開啟的功能
- Google OAuth Provider 尚未在 Google Cloud 與 Supabase Auth 後台設定。
- Supabase 尚未與 Render 遊戲伺服器實際交換驗證 JWT。
- 玩家戰績尚未寫入資料庫；跨裝置從帳號找回對戰仍未上線。
- 現有遊客對局與 5 分鐘重連規則依然走 Render + Socket.IO 原機制。

## 下一步（免費方案）
1. 在 Google Cloud 建立 OAuth Web Client，完成品牌、網域設定。
2. 使用 Supabase Auth Google Provider 指定 OAuth Client ID、Client Secret，並將 Google OAuth Redirect URI 設定為 `https://xhtkcuuaqgihlduasnqn.supabase.co/auth/v1/callback`。
3. 將 App Site URL／Redirect allow list 包含 `https://king-war-online-full.onrender.com`，在實際環境核對設定。
4. 新增 `@supabase/supabase-js` 並**鎖定版本與 commit lockfile**。前端僅能使用 publishable key；secret/service_role key 必須留在伺服器。
5. 後端以 Supabase Auth 驗證 JWT，使用內部 `user_id` 與對局成員映射來授予重連權限；不能只信任瀏覽器傳入的 playerId 或 email。
6. 由伺服器使用受保護的連線與密鑰將對局狀態加密後存入 `active_matches`，增加版本號、衝突控制、保留政策及恢復測試。
7. 整合對戰結算資料，再為前端提供玩家戰績與個人資料管理。
8. 在測試環境驗證 Google 登入、匿名升級、跨裝置重連、離線倒數、強制投降與安全性後才公開帳號入口。

## 安全原則
- Render 伺服器仍是遊戲規則與戰鬥操作的唯一權威。
- 不在 GitHub 提交 Google Client Secret 或 Supabase secret/service_role key。
- `active_matches.state_ciphertext` 必須由伺服器先加密，且不能透過 Data API 對玩家開放。
- 不擅自購買付費方案；超出 Free 層限制時先停止並評估。
