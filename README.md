# 台灣公車追蹤 — Even Realities G2

[English](README_EN.md)｜繁體中文

專為 Even Realities G2 與 Even Hub 打造的台灣公車即時查詢 App。目前以大台北公車資料為主，提供附近站牌、即時到站、完整路線站序、車輛位置／車牌，以及可自訂分組的常用路線。

目前版本：`0.10.16`

## 功能特色

- 預設以臺北車站為中心；僅在附近站牌頁啟用手機 GPS，取得定位後自動改用使用者位置，離開該頁即停止定位。
- 依直線距離列出最近 20 個站牌，並顯示行經路線。
- 同名站牌先以 80 公尺形成實體群組；不同群組只有在共享同一路線的相反方向，且合併後所有位置彼此不超過 150 公尺時，才合併為一個附近乘車地點。每個地點最多只做一次互補合併，避免跨第三站連鎖。詳細頁每條路線只顯示一次，初次優先顯示最早到站的方向，停留期間不會自行翻向，進入路線後仍可手動切換方向。
- 每 5 秒更新預估到站時間，不重設手機捲動位置、G2 焦點或目前分頁。
- 路線頁顯示完整站序、去回程、各站 ETA、目前站牌與即時車牌。
- 車輛資料會先正規化 Route ID／`pathAttributeId`，再將 500 公尺內的車輛配對至同路線、同方向的最近站點。
- 手機可搜尋路線、以星號加入常用路線，並新增、重新命名或刪除自訂分組。
- G2 僅供快速瀏覽，所有常用路線與分組編輯都在手機完成。
- G2 右上角以 `HH:MM:SS` 顯示資料來源更新時間。
- 手機畫面與資料抓取不等待 G2 Bridge；所有眼鏡 Bridge 呼叫仍維持單一序列，避免頁面與圖片傳輸互撞。
- 不使用假 ETA、假車輛或假車牌；資料無法取得時會顯示明確錯誤或保留最後成功資料。

## 操作方式

| 頁面 | G2 上滑 | G2 下滑 | G2 單擊 | G2 雙擊 | 手機 |
|---|---|---|---|---|---|
| 首頁 | 上一個選項 | 下一個選項 | 進入選項 | 離開 G2 頁面 | 點選功能 |
| 常用路線 | 循環切換分組 | 循環選取路線 | 進入路線詳情 | 返回首頁 | 點分頁、搜尋、加入與管理分組 |
| 附近站牌 | 上一站 | 下一站 | 進入站牌詳情 | 返回首頁 | 點選站牌 |
| 站牌詳情 | 上一條路線 | 下一條路線 | 進入路線詳情 | 返回附近站牌 | 左上角返回或點選路線 |
| 路線詳情 | 上一站 | 下一站 | 切換方向 | 返回上一頁 | 點方向分頁，左上角返回 |

## 即時資料與隱私

App 透過 `https://taiwan-bus.0ruka.dev` 連線至部署於 Raspberry Pi 5 的即時資料代理，代理來源為臺北市公共運輸處公開 gzip 資料：

- `GetStop.gz`：站牌與路線站序。
- `GetRoute.gz`：路線名稱、起點與終點。
- `GetEstimateTime.gz`：即時預估到站。
- `GetBusData.gz`：即時車輛座標、方向與車牌。

代理會預熱四個資料來源、合併重複的上游請求，並在快取過期時先回傳最後成功資料、同時於背景重新驗證。回應包含 cache 狀態、age 與來源時間，App 顯示的是資料來源的 `UpdateTime`，不是手機接收時間。

手機定位只在裝置端用於計算距離與排序附近站牌，不會附加在上述公車資料請求中。專案不包含 TDX Client Secret 或其他 API 金鑰。

## 技術需求

- Node.js `>=22.12.0`（包含測試所需的 TypeScript type stripping）
- npm
- Even Realities App／Even Hub Host `2.0.0` 以上
- Even Hub SDK `0.0.14`（Even App `2.2.9` 以上）
- 官方 Even Hub Simulator `0.8.0`（選用）

## 快速開始

```bash
npm install
npm run dev
```

預設開發伺服器會監聽所有網路介面。若要在 G2 實機測試，手機與電腦需位於同一區域網路，接著在另一個終端機執行：

```bash
npx evenhub qr --url "http://你的電腦區網IP:5173"
```

在 Even Realities App 啟用 Developer Mode、掃描 QR code，並在首次使用時允許定位權限。

## 使用官方 Simulator

終端機 1：

```bash
npm run dev
```

終端機 2：

```bash
npm run simulate
```

若需要 automation API：

```bash
npm run simulate:automation
```

Ubuntu／Debian 原生依賴：

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-0 libjavascriptcoregtk-4.1-0 libsoup-3.0-0
```

Simulator `0.8.0` 未實作目前 App 使用的 GPS Bridge，因此模擬器會使用預設臺北座標。真實 GPS 權限與定位更新需在 Even Realities App／G2 實機驗證。

## Build 與 EHPK 打包

```bash
npm run build
npm run pack
```

輸出檔案：`taiwan-bus-g2-v0.10.16.ehpk`

可先使用 production preview 檢查最終 `dist`：

```bash
npm run preview
```

## 即時資料代理

代理程式位於 `server/server.mjs`，預設只監聽 `127.0.0.1:8893`：

```bash
node server/server.mjs
```

正式環境可使用 `server/taiwan-bus-g2-proxy.service` 交由 systemd 管理，再透過 Cloudflare Tunnel 對外提供 HTTPS。請勿直接把未受保護的代理連接埠公開到網際網路。

## 專案結構

```text
.
├── app.json                         # Even Hub App manifest 與權限
├── index.html                       # 手機 WebView HTML／CSS
├── src/main.ts                      # 狀態、資料、GPS、手機與 G2 UI
├── server/server.mjs                # 即時資料快取代理
├── server/taiwan-bus-g2-proxy.service
├── SIMULATOR_VALIDATION.md          # 實際 Simulator 操作與回歸證據
├── README.md                        # 繁體中文文件
└── README_EN.md                     # English documentation
```

## 穩定性設計

- 以單一 Promise queue 序列化原生頁面操作；系統退出只序列化送出順序，不因等待 Host 對話框回覆而占用佇列。
- 進行中的相同資料請求共用同一個 Promise。
- 網路抓取與 G2 頁面建立並行，但 G2 更新會等待容器建立完成。
- 頁面世代、圖片世代與方向狀態會在等待及重試後重新確認，避免舊工作覆蓋新頁。
- G2 方向圖會在工作階段內記住 Host 已接受的格式；失敗時仍保留另一格式與三文字容器相容頁。
- 五秒更新使用文字升級而非整頁重建，避免選取與捲動位置重置。

## 驗證狀態

`0.10.16` 依使用者提供的 `0.10.15` 實機 trace 修正原生 foreground layer 的 lifecycle：開啟（`4`）時暫停工作，關閉（`5`）時恢復目前頁面與輸入；真正的 system／abnormal exit 仍會清理程式。舊處理在「否」後設為 `active=false`，因此丟棄已收到的單擊及雙擊。

- 54 項測試全部通過。以實際 `3 → 退出請求接受 → 4 → 5 → list／sys 點按` 序列建立的回歸測試，在 `0.10.15` 失敗、修正後通過；也涵蓋沒有新退出請求的第二組 `4 → 5`。Host 對話框回覆仍不占用繪製佇列。
- 已於 2026-10-04（Asia/Taipei）通過正式建置、版本檢查及打包。這個候選套件已關閉診斷，正常建置沒有手機 trace 面板與獨立觀察 listener。
- 最終 build 通過官方 Simulator 的 12 次輸入，涵蓋首頁、附近站牌、到站資訊、路線方向、常用路線、返回及退出，console 無錯誤。Simulator 無法操作「否」，這項結果仍與實機驗證分開。
- 套件：`taiwan-bus-g2-v0.10.16.ehpk`，**1,082,471 bytes**；SHA-256：`3d18b0b74f32cff9b14205df06193b9eea7563a2a1d731c59b0ea1b0917f0dd3`。
- 已於 2026-10-04（Asia/Taipei）上傳，來源 commit 為 `80a3e53`；重新載入 Even Hub 確認狀態為 **Private**。
- 2026-10-04 使用者確認已安裝 `0.10.16`：連續三次「雙擊 → 否 → 單擊 → 返回首頁再雙擊」正常，選「是」也能回到系統。在後續 Beta 驗收要求後，使用者再次確認正常並授權公開。這些是使用者回報的實機驗證。Host／firmware 版本及耗電／溫度尚未取得；proxy 尚未部署。
- 本人 Beta 測試邀請已送達 email，Portal 當時顯示 **Invited**；接受方式為在手機點邀請郵件的 **Accept and install**。送審隱私草稿已更新網際網路權限、代理與上游來源，以及定位僅供本機排序的說明；重新載入後已確認保存，尚未公開。
- `0.10.16` 已於 2026-10-04 01:07（Asia/Taipei）送出公開審核，重新載入 Portal 確認 **In review**，並有 **Submitted** 紀錄；公開版本仍為 `0.10.11`，待 Even 審核通過。

### 診斷調查

`0.10.15` 是 Private 診斷建置，尚未證明已修復取消退出。使用者確認已安裝的 `0.10.14` 選「否」後仍失去點按；需先取得 Host 事件與程式狀態的實際序列，再進行下一項修正及公開送審。

- 使用 `VITE_INPUT_DIAGNOSTICS=0.10.15 npm run build` 建置診斷版，再執行 `npm run pack`。一般正式建置不包含手機診斷面板與獨立觀察 listener。
- 本機手機面板只保留最近 64 筆操作紀錄：事件代碼、數字容器／選取欄位、active／disposed 狀態、頁面 lifecycle 與 Bridge 送出／結果。不記錄 raw payload、識別資料、座標或內容，也不透過網路傳送診斷資料。獨立 SDK listener 可在主程式取消訂閱後繼續觀察。
- 53 項測試全部通過；退出回覆未完成的案例啟用診斷後，受影響的 14 項 runtime 測試也通過。正式建置、版本檢查與打包通過。官方 Simulator 的五次輸入顯示診斷面板能記錄安全事件與實際 Bridge 結果，console 無錯誤；這不代表實機取消已正常。
- 診斷套件：`taiwan-bus-g2-v0.10.15.ehpk`，**1,083,929 bytes**；SHA-256：`e219667b7f9be9e1eb966191e738de02c8cccea55735589df2785741da59d21b`。
- 已於 2026-10-03（Asia/Taipei）上傳，來源 commit 為 `257dcbc`；重新載入 Even Hub 確認狀態為 **Private**。待取消退出問題解決且通過實機驗證後，再進行公開送審。
- 2026-10-04 收到的使用者 trace 顯示原生 `4 → 5` 後，sys 雙擊及 list 單擊持續送達，但 `active=false`、`disposed=false`，直接定位到程式的 foreground layer 處理錯誤。診斷現在將內部狀態動作與真正收到的 SDK 事件代碼分開標示。

### 前一修正候選版

`0.10.14` 已於 2026-10-03（Asia/Taipei）完成建置與打包，供實機驗證。系統退出只序列化呼叫的送出順序；未完成的 Host 對話框回覆不再阻塞後續原生頁面操作或再次退出。這項修正不假設「否」會送出前景事件，也不將特定 boolean 當成取消結果。

- 49 項測試全部通過。新增回歸案例在 `0.10.13` 會重現退出回覆未完成造成的佇列卡死；修正後的正式函式能繼續處理單擊導覽、文字更新與再次雙擊退出，既有繪製也仍會先完成才送出退出呼叫。
- 最終 production build、版本一致性檢查及 CLI `0.1.13` 打包通過；使用 SDK `0.0.14`、Node `23.11.0`，要求 Even App `2.2.9` 以上。打包輸入僅包含 manifest、HTML、JavaScript 與內附字型。
- 正式 build 通過官方 Simulator `0.8.0` 的 12 次輸入，涵蓋首頁、附近站牌、到站資訊、路線方向、常用路線、返回及退出，console 無錯誤。Simulator 退出時會直接清空畫面，沒有「是／否」對話框，無法驗證取消；受控 Host 測試證明的是佇列行為，並非 G2 實際取消事件序列。
- 套件：`taiwan-bus-g2-v0.10.14.ehpk`，**1,082,420 bytes**；SHA-256：`5dbb2b55bdd9cf75437abcba6317812c6fa74b7fc5db673cb8a0b24b4f827c70`。
- 已於 2026-10-03（Asia/Taipei）上傳 Even Hub，重新載入後確認 `0.10.14` 位於 **Private builds**。來源 commit：`9f960ba`。尚未送出公開審核，公開版本仍為 `0.10.11`。
- 再次公開送審前需確認實機取消退出後仍可操作。Host／firmware 版本、BLE 可靠性及耗電／溫度仍未驗證；server 修正尚未部署。

### 歷史驗證

`0.10.13` 於 2026-10-03 21:31（Asia/Taipei）送審，但使用者確認已安裝的新版本在按「否」後仍會點按失效。其前景事件測試未涵蓋 Host 退出回覆一直未完成的情境，送審不能視為修復成功的證據。

`0.10.12` 通過 45 項測試與 Simulator 檢查，於 2026-09-30 送審；Even Hub 在 2026-10-03 20:31（Asia/Taipei）因取消系統退出對話框後點按失效而拒絕。其 SDK 為 `0.0.12`；`0.10.13` 已升級至目前提交門檻 `0.0.14`。

`0.10.11` 已使用官方 Simulator `0.8.0` 與正式即時 API 驗證 150 公尺條件式合併、附近站牌及站牌詳情的每路線單列顯示：

- 「天母棒球場(忠誠)」與「天母棒球場(士東)」在附近清單中各只顯示一次；同一站牌內相同 Route ID 也只顯示一次。
- 自動測試、production build、打包與 Simulator 手勢流程均通過。
- 詳細步驟、環境與畫面檔名請見 [SIMULATOR_VALIDATION.md](SIMULATOR_VALIDATION.md)。

Simulator 無法完全取代實機 BLE、Host 與 G2 韌體驗證。方向圖片仍保留已驗證的格式探測、有限重試、跨頁失效與文字相容方案。

## 授權

此專案目前尚未指定開源授權。公開 GitHub Repository 前，請依預期的使用與貢獻方式加入合適的 `LICENSE`。
