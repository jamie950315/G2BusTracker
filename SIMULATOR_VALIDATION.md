# Even Hub Simulator 眼鏡手勢驗證

- App：台灣公車追蹤 `0.10.9`

## `0.10.9` 手機／G2 並行渲染與即時資料快取

本版針對「點擊後要等很久才進下一頁」與五秒更新偶發高延遲做實測拆解，保留 `0.10.8` 已通過的 G2 圖片世代防護、三容器相容頁及全域 Bridge 序列化：

- 手機 WebView 在頁面狀態變更後立即渲染，不再等待 G2 rebuild、文字更新或圖片傳輸完成。
- ETA／車輛資料請求與 G2 頁面建立同時開始；資料先更新手機，G2 更新仍等待目標容器建立完成，並在等待前後檢查頁面世代，避免舊頁結果覆蓋新頁。
- 相同 URL／cache mode 的進行中請求共用同一個 Promise；常用路線剛抓 ETA 又立即進路線時，不會重複下載及解壓同一份資料。
- 車輛定位先篩到目前路線才做最近站點計算，避免每五秒對整份車輛資料與所有路線站序做無效距離運算。
- G2 方向圖第一次成功後記住該 Host 接受的格式。本輪 Simulator 首次 `raw4` 兩次回傳 `sendFailed` 後選定 PNG；之後方向切換兩張 PNG 約 `21ms` 完成，沒有再重試 raw4。
- Pi 5 代理已改為預熱四個 feed、合併相同 upstream request、過期資料立即回傳並在背景重驗。代理本機暖快取為約 `1–5ms`；Simulator 經公開 Tunnel 暖機後，ETA／Bus response header 約 `244–299ms`。來源時間仍使用 API 的 `UpdateTime`，沒有拿快取接收時間冒充即時資料時間。

2026-07-19 以官方 Simulator `0.8.0`、SDK `0.0.12`、正式 `https://taiwan-bus.0ruka.dev/blobbus` 即時資料完成三輪實際操作；原生依賴只解壓於 `/tmp`，WebKitGTK／JSC 使用已驗證的 `2.44.0-2`，沒有修改系統套件：

| 頁面／情境 | 實際操作 | 結果 |
|---|---|---|
| 首頁 | Up、Down、Click、Double click | 兩個功能選取、進入及離開正常 |
| 空白／有資料常用路線 | Up 切分組、Down 循環路線、Click 進路線、Double click 返回 | 分組與焦點保留，三容器表格正常，沒有 fallback |
| 常用路線開啟的 `265經明德路` | Click 切方向、Down、Up、等待多輪五秒更新、Double click | 方向圖、站序、時間與返回正常；`199-U3` 顯示於站列最右側 |
| 附近站牌 | Up、Down、Click | 進入「臺北車站(忠孝)」正常 |
| 站牌詳情 | Down、Up、Click、Double click | ETA 排序、選取、進路線及返回正常 |
| 站牌開啟的 `和平幹線` | Click、Down、Up、Double click | 方向切換、車牌 `EAL-0031`、站序及逐層返回正常 |
| 快速離頁 | Click 進路線後短時間 Double click，再等待舊請求完成 | 頁面維持在返回目標；沒有舊圖片或 fallback 蓋回路線頁 |

- 最終並行版 console：`192` 筆事件，App error `0`、route/favorites fallback `0`、rebuild failure `0`、G2 圖片錯誤 `0`；路線由常用與附近站牌各成功開啟一次。檔案：`simulator-validation/console-v0109-final-parallel.json`。
- 打包後另以 `npm run preview` 直接載入最終 `dist` 再跑一次官方 Simulator：從首頁進附近站牌、站牌詳情、`274` 路線、Click 切方向並逐層 Double click 返回；共 `80` 筆事件，App error `0`、fallback `0`、路線開啟 `1` 次、方向切換 `1` 次。檔案：`simulator-validation/console-v0109-dist-smoke.json`；畫面：`simulator-validation/simulator-window-v0109-dist-route.png`，可見 G2 最右側車牌 `513-U3`。
- 最終常用路線與路線資料：`simulator-validation/simulator-window-v0109-final2-favorites.png`、`simulator-validation/simulator-window-v0109-final2-route-data.png`。
- 方向切換與返回：`simulator-validation/simulator-window-v0109-final2-route-gestures.png`、`simulator-validation/simulator-window-v0109-final2-favorites-return.png`。
- 附近站牌入口與車牌：`simulator-validation/simulator-window-v0109-final2-station.png`、`simulator-validation/simulator-window-v0109-final2-station-route.png`。
- 最初完整手勢矩陣另有 `608` 筆 console、App error `0`、fallback `0`；加入常用路線後的第二輪為 `58` 筆、App error `0`、fallback `0`。檔案分別為 `simulator-validation/console-v0109-all-scenarios.json`、`simulator-validation/console-v0109-populated-favorites.json`。
- Simulator `0.8.0` 未實作 GPS bridge，App 依設計使用預設臺北座標；實機 GPS 仍須由 G2 Host 確認。Simulator 也不等同實機 BLE／韌體，因此 `raw4` 在目標 G2 是否直接成功仍以安裝 `0.10.9` 後的實機結果為準；即使圖片格式被拒絕，現有三文字容器保護頁仍保留完整操作。

## `0.10.8` 路線圖片傳輸與跨頁渲染防護

- 使用者在實機路線頁取得 `dir-tab-0: raw4=sendFailed, png=sendFailed`。SDK `0.0.12` 將 `sendFailed` 定義為傳輸錯誤，不是尺寸或灰階轉換錯誤；因此不再把它誤判為圖片內容格式不合規。
- 路線頁重建成功後先等待 `650ms` 讓 Host／G2 完成頁面切換；只有 `sendFailed` 會以 `700ms` 間隔重送一次。同一格式若回傳尺寸或轉換錯誤則不做無意義重試，再嘗試另一個 Host 相容格式。
- 每次路線圖片更新都綁定 ETA 頁面世代、圖片世代及目前方向。使用者離開路線或快速切換方向後，舊任務即標記為 stale，不再傳第二張舊圖，也不能重建路線 fallback 覆蓋新頁。
- 兩種圖片格式重試後仍不可用時，改用已驗證的三文字容器路線頁；文字頁成功代表功能性相容，不再在手機顯示紅色「G2 圖片錯誤」。只有連文字頁也建立失敗才顯示 `G2 顯示錯誤`。

2026-07-19 以官方 Simulator `0.8.0`、SDK `0.0.12`、正式 `https://taiwan-bus.0ruka.dev/blobbus` 即時資料完成全頁面實際操作：

| 頁面／競態 | 實際操作 | 結果 |
|---|---|---|
| 首頁 | Down、Up、Click | 常用路線／附近站牌選取及進入正常 |
| 常用路線 | Up 連續切換「分組 2／常用」、Down、Click、Double click | 分組、焦點、進路線及返回全部正常 |
| 常用路線開啟的 `0東` | Down、Up、Click、等待超過兩輪更新、Double click | 站序、方向反白、即時更新及返回正常；手機沒有紅色錯誤 |
| 附近站牌 | Down、Up、Click | 進入「臺北車站(忠孝)」正常 |
| 站牌詳情 | Down、Up、Click、Double click | 到站列選取、進路線及返回正常 |
| 站牌開啟的 `14` | Down、Up、Double click | 路線頁及逐層返回正常 |
| 快速離頁競態 | Click 進 `14` 後 `0.2s` 立即 Double click，等待 `8s` | 維持站牌詳情；舊圖片／fallback 沒有覆蓋新頁 |

- Simulator 會拒絕實機 `raw4`，本輪每張圖的 `raw4` 兩次皆回傳預期 `sendFailed`，隨後 PNG 第一次成功；共六次 `direction image ready`。
- 最終 console 共 `410` 筆，`0` 個 App error、`0` 次 route fallback、`0` 次 rebuild／update／rejected failure；分組切換依序記錄「分組 2／常用」。
- 路線頁（手機無錯誤、G2 方向圖成功）：`simulator-validation/simulator-window-v0108-route-from-favorite.png`。
- 方向切換：`simulator-validation/simulator-window-v0108-route-direction.png`。
- 首頁／常用／附近／站牌：`simulator-validation/simulator-window-v0108-home.png`、`simulator-validation/simulator-window-v0108-favorites.png`、`simulator-validation/simulator-window-v0108-nearby.png`、`simulator-validation/simulator-window-v0108-station-detail.png`。
- 快速離頁防護：`simulator-validation/simulator-window-v0108-stale-route-return.png`。
- 完整 console：`simulator-validation/console-v0108-all-pages.json`；程序紀錄：`simulator-validation/simulator-v0108.log`。
- Simulator 證明重試、世代隔離及全頁導覽正常；使用者截圖來自實機 `sendFailed`，因此重試能否在該次 BLE 狀態恢復仍須安裝 `0.10.8` 實機確認。即使實機持續拒絕圖片，三容器文字路線頁仍會保留完整手勢且不再顯示紅色成功降級訊息。

## `0.10.7` 常用路線手勢重新映射

- 常用路線頁的 G2 手勢已改為：Down 循環選取路線、Up 循環切換分組、Click 進入目前選取路線的即時詳細頁、Double click 返回首頁。
- SDK 的文字事件與系統事件兩條 Click 路徑都改為呼叫同一個 `openSelectedFavoriteRoute()`，避免不同 G2 Host／韌體事件來源產生不同結果。
- 常用路線純文字最後保護畫面的手勢提示同步改為「點按進入｜下滑選取｜上滑分組」。

2026-07-19 以官方 Simulator `0.8.0`、SDK `0.0.12`、正式 `https://taiwan-bus.0ruka.dev/blobbus` 即時資料實際操作；沿用先前透過手機 WebView 加入的五筆 `0東` 常用路線與「分組 2」，沒有注入測試 fixture：

| 實際操作 | 預期結果 | Simulator 結果 |
|---|---|---|
| 常用路線 Down | 從第一筆循環到第二筆 | 焦點移至「麗寶大樓」，沒有進入路線，通過 |
| 常用路線 Up | 從「常用」切到下一分組 | 切換至空白的「分組 2」，通過 |
| 再次 Up | 循環回「常用」 | 回到五筆資料並重設為第一筆，通過 |
| Down 後 Click | 選取第二筆並進入詳細頁 | 進入 `0東` 往臺北車站即時路線，選取站為「麗寶大樓」，通過 |
| 路線 Double click | 返回常用路線 | 返回「常用」且第二筆焦點保留，通過 |
| 常用路線 Double click | 返回首頁 | 回到「常用路線／附近站牌」首頁，通過 |

- App console：`0` 個 error；分組事件依序記錄 `favorite group: 分組 2`、`favorite group: 常用`，三容器表格成功建立四次，沒有 table fallback、rejected 或 update failure。
- 預期 warning 僅為 Simulator 未實作 GPS bridge，以及 Simulator 拒絕實機 `raw4` 方向圖後改用既有 PNG 相容格式；沒有影響這次手勢流程。
- 下滑選取：`simulator-validation/simulator-window-v0107-down-selects-route.png`。
- 上滑切組：`simulator-validation/simulator-window-v0107-up-switches-group.png`。
- 單擊進路線：`simulator-validation/simulator-window-v0107-click-opens-route.png`。
- 雙擊返回：`simulator-validation/simulator-window-v0107-double-return-favorites.png`、`simulator-validation/simulator-window-v0107-double-return-home.png`。
- 完整 console：`simulator-validation/console-v0107-gesture-mapping.json`；程序紀錄：`simulator-validation/simulator-v0107.log`。

## `0.10.6` 三容器正式表格與實機相容性修正

- 使用者安裝 `0.10.5` 後，實際診斷顯示四容器表格仍連續兩次回傳 `false`，隨後三容器純文字相容畫面成功；因此撤回「四容器是安全上限」的結論。
- 這項結果不能單獨證明容器數是唯一原因，因為成功的三容器 fallback 同時改變了框線、幾何與內容。`0.10.6` 採取最小可驗證改動：把正式表格重構為三個文字容器，再由實機確認這個精確 payload。
- 第一個 `favorite-header` 容器高度 `87`，第一行顯示「常用路線／分組」及 `HH:MM:SS`，第二行顯示欄位名稱；底框將欄名與數值分開。`favorite-row-0`、`favorite-row-1` 各自是獨立框線資料列，合計恰好三個容器及一個事件捕捉容器。
- 三容器表格第一次失敗仍會序列化重試；連續兩次失敗才改用一個全頁文字容器。手機診斷已改為明確區分「三容器表格」與「單容器相容模式」。

2026-07-18 以官方 Simulator `0.8.0`、SDK `0.0.12`、正式 `https://taiwan-bus.0ruka.dev/blobbus` 即時資料完成實際操作；Simulator 不支援 GPS bridge，因此使用 App 的預設臺北座標：

- 從手機 WebView 實際選擇 `0東`，逐一點擊五個站牌星號加入常用路線，並以「管理分組 → 新增分組」建立「分組 2」。
- 三容器正式表格成功建立四次；console 為 `0` 個 app error、`0` 次 table retry、`0` 次 rejected、`0` 次 fallback、`0` 次資料列／時間更新失敗。
- 常用路線 Click 循環「常用／分組 2」；連續四次 Down 選到第五筆「內湖運動中心」，等待超過一輪五秒更新後仍保持選取，兩列視窗沒有跳回頂端，時間由 `23:51:50` 更新至 `23:52:38`。
- Up 從第五筆進入 `0東` 即時路線；路線 Up／Down 正常，Click 將方向由往臺北車站切換為往內湖，Double click 返回常用路線且第五筆焦點仍保留。
- 首頁 Down／Up／Click、附近站牌 Up／Down／Click、站牌詳情 Up／Down／Click、路線 Up／Down／Click，以及 route → detail → nearby → home → 關閉的連續 Double click 全部通過。
- `299` 即時路線在「捷運善導寺站」一列顯示真實車牌 `170-U7`；手機及 G2 都位於該列最右側。之後 Click 正常切換至另一方向。
- 預期 warning 僅有 Simulator 未實作 GPS bridge，以及 Simulator 拒絕實機 `raw4` 方向圖後由既有 PNG 相容格式成功顯示；兩者都未造成功能降級。

| 頁面 | Up | Down | Click | Double click | 結果 |
|---|---|---|---|---|---|
| 首頁 | 選取常用路線 | 選取附近站牌 | 開啟選項 | 清空 G2 前景頁 | 通過 |
| 常用路線 | 開啟所選即時路線 | 循環五筆並跨兩列視窗 | 循環分組 | 返回首頁 | 通過 |
| 常用路線開啟的 `0東` | 站序向上 | 站序向下 | 切換方向 | 返回常用路線 | 通過 |
| 附近站牌 | 選取上一站 | 選取下一站 | 開啟臺北車站(忠孝) | 返回首頁 | 通過 |
| 站牌詳情 | 選取上一條 | 選取下一條 | 開啟 `299` | 返回附近站牌 | 通過 |
| `299` 路線 | 站序向上 | 站序向下 | 切換方向 | 返回站牌詳情 | 通過 |

- 正式三容器表格：`simulator-validation/simulator-window-v0106-favorites-data-ready.png`。
- 第五筆刷新後：`simulator-validation/simulator-window-v0106-favorites-fifth-final.png`。
- 車牌最右側：`simulator-validation/simulator-window-v0106-nearby-route.png`。
- 路線方向切換：`simulator-validation/simulator-window-v0106-nearby-route-direction.png`。
- 完整 console：`simulator-validation/console-v0106-all-scenarios.json`；程序紀錄：`simulator-validation/simulator-v0106.log`。
- Simulator 驗證證明最終程式會建立三容器表格且所有手勢正常；目標 G2／Host 是否接受這個新三容器正式 payload，仍需安裝 `0.10.6` 後確認。

## `0.10.5` 四容器表格（實機已確認拒絕）

- 使用者安裝 `0.10.4` 後，實際手機診斷顯示六容器表格在全域 Bridge 序列化後仍連續兩次回傳 `false`，隨後三容器相容畫面立即成功；因此 Bridge 重疊不是這次降級的根因。
- 現行 Even Realities SDK reference 宣告 `containerTotalNum` 可到 12、文字／列表最多 8；但多個實機模板與已發布 App 明確以「每頁最多四個容器」設計。這表示 Simulator／SDK 宣告和部分已部署 Even App Host／G2 韌體之間存在相容性落差。
- `0.10.5` 將常用路線表格限制為四個真正獨立容器：標題與 `HH:MM:SS` 合併為一列、欄位名稱為一列、兩筆資料各自一列。後續實機安裝證明該 payload 仍連續兩次回傳 `false`，不可視為實機安全方案。
- 每頁顯示兩筆；Down 仍循環所有常用路線並自動移動兩列視窗，Up 進入所選路線，Click 切換分組，Double click 返回。
- 四容器表格保留一次序列化重試及三容器最後保護；Simulator 成功時 console 記錄 `favorites table ready: 4 containers`，但此結果已被目標實機拒絕結果推翻。

資料來源：

- Even Realities SDK reference：https://github.com/even-realities/everything-evenhub/blob/main/skills/sdk-reference/SKILL.md
- 四容器實機模板：https://github.com/brianmatzelle/even-realities-g2-glasses
- 四容器實機 App：https://github.com/nickustinov/weather-even-g2
- 四文字容器實機遊戲：https://github.com/takashicompany/make15

2026-07-18 以官方 Simulator `0.8.0`、SDK `0.0.12`、正式 `https://taiwan-bus.0ruka.dev/blobbus` 即時資料完成實際操作；沒有使用 fixture 或假 ETA：

- 在 Simulator 手機 WebView 實際開啟搜尋頁，選擇路線 `0東`，逐一點擊五個站牌星號加入常用路線；另以「管理分組 → 新增分組」建立「分組 2」。
- 四容器表格共成功建立九次，console 每次皆記錄 `favorites table ready: 4 containers`；`0` 次 retry、`0` 次 rejected、`0` 次 fallback、`0` 次資料列更新失敗。
- 連續四次 Down 均由原始事件串流確認；第五筆「內湖運動中心」被選取後等待超過一輪五秒更新，仍保持在第二列，兩列視窗沒有跳回頂端，右上角時間由 `23:13:10` 更新為 `23:13:20`。
- Up 從第五筆進入 `0東` 即時路線；路線 Up／Down 正常，Click 將方向由 `0 → 1`，Double click 返回常用路線且第五筆焦點仍保留。
- Click 在「分組 2／常用」之間循環，空分組及有資料分組均維持四容器表格。

| 頁面 | Up | Down | Click | Double click | 結果 |
|---|---|---|---|---|---|
| 首頁 | 選項回到常用路線 | 選取附近站牌 | 開啟選取功能 | 清空 G2 前景頁 | 通過 |
| 常用路線 | 開啟所選即時路線 | 循環五筆、跨兩列分頁 | 循環分組 | 返回首頁 | 通過 |
| 常用路線開啟的 `0東` | 站序向上 | 站序向下 | 方向 `0 → 1` | 返回常用路線 | 通過 |
| 附近站牌 | 選取上一站 | 選取下一站 | 開啟「臺北車站(忠孝)」 | 返回首頁 | 通過 |
| 站牌即時到站 | 選取上一條 | 選取下一條 | 開啟當輪 `652` 方向 `1` | 返回附近站牌 | 通過 |
| `652` 路線 | 站序向上 | 站序向下 | 方向 `1 → 0` | 返回站牌即時到站 | 通過 |

- 最終 console：`0` 個 error。預期 warning 僅有 Simulator 未實作 GPS bridge，以及 Simulator 不接受實機 `raw4` 圖片後由既有 PNG 相容格式成功顯示；兩者都沒有造成功能降級。
- 表格實際畫面：`simulator-validation/simulator-window-v0105-favorites-initial.png`；第五筆刷新後：`simulator-validation/simulator-window-v0105-favorites-fifth-after-refresh.png`。
- 分組循環：`simulator-validation/simulator-window-v0105-favorites-click-group-cycle.png`；路線方向切換：`simulator-validation/simulator-window-v0105-favorite-route-after-direction.png`。
- 完整原始事件與 console：`simulator-validation/console-v0105-all-scenarios.json`；程序紀錄：`simulator-validation/simulator-v0105.log`。

## `0.10.4` 官方限制核對與 Bridge 全域序列化

- 使用者安裝 `0.10.3` 後實際 G2 仍進入相容模式，因此撤回「實機最多六個文字容器」的推測。
- Even Realities 官方 `everything-evenhub` SDK reference 明確記載：每頁最多 12 個容器、文字／列表最多 8 個、圖片最多 4 個；每頁必須恰好一個 `isEventCapture: 1`，ID／名稱必須唯一，名稱最多 16 字元。`0.10.3` 的六容器表格符合這些限制。
- 官方 glasses UI guidance 另外要求所有 Bridge 呼叫序列化，不只是圖片；畫面、文字／圖片更新、儲存與裝置呼叫共用裝置連線。舊程式只有圖片佇列，確實違反這條規範。
- `0.10.4` 把 startup、rebuild、文字、圖片、儲存、定位與 shutdown 全部送進同一 Promise 佇列。表格第一次 `rebuildPageContainer` 回傳 `false` 時先重試同一個已通過規格檢查的表格，連續兩次失敗才使用相容模式。
- 手機常用路線頁會顯示重試／連續失敗診斷。SDK 的 rebuild API 只回傳 `boolean`，因此不捏造不存在的 firmware error code。
- 使用者安裝後已確認仍會降級；全域 Bridge 序列化應保留，但它不是六容器畫面被該實機 Host 拒絕的根因。`0.10.5` 的四容器表格也被同一實機拒絕，後續 `0.10.6` 改採三容器正式表格與單容器最後保護。

官方資料：

- https://github.com/even-realities/everything-evenhub/blob/main/skills/sdk-reference/SKILL.md
- https://github.com/even-realities/everything-evenhub/blob/main/plugins/everything-evenhub/skills/glasses-ui/SKILL.md

2026-07-18 以官方 Simulator `0.8.0`、SDK `0.0.12`、正式即時資料重新冷啟動並操作完整手勢：

- 手機 WebView 實際加入五筆 `206` 常用路線及第二分組。
- 常用路線四次 Down、等待定時更新、Up 進入 `206`、路線 Up／Down／Click 切換方向、Double click 返回均通過。
- 附近站牌、站牌詳情、第二條即時路線與逐層 Double click 返回均通過。
- App console：`0` 個 error、`0` 次 table retry、`0` 次 fallback、`0` 次 row update failure。
- 表格畫面：`simulator-validation/simulator-window-v0104-favorites-six-container-table.png`。
- 完整事件：`simulator-validation/console-v0104-all-scenarios.json`；程序紀錄：`simulator-validation/simulator-v0104.log`。

## `0.10.3` 獨立表頭與資料分隔線

- 欄位名稱不再和第一筆數值放在同一個文字容器；表頭「到站／路線／方向／站牌」現在是獨立一列，資料從下一列開始。
- 表頭與每筆資料都使用獨立框線，因此表頭下方及各筆資料之間都有完整水平分隔線。
- 為維持實機相容的六個文字容器上限，G2 每頁由四筆改為三筆：標題、更新時間、獨立表頭及三個資料列合計仍為六個容器；其餘常用路線可繼續下滑循環查看。
- 2026-07-18 以官方 Simulator `0.8.0` 冷啟動，從手機 WebView 實際加入五筆 `206` 路線及第二分組，再操作全部 G2 手勢。
- 四次 Down 均由事件串流確認送達；第五筆在等待超過一輪更新後仍被選取，三列視窗沒有跳回頂端。
- `206` 常用路線及附近站牌選到的 `14` 路線均完成 Up、Down、Click 切換方向與 Double click 返回。
- App console：`0` 個 error、`0` 次 `favorites table rejected`、`0` 次 `favorite row update failed`。
- 獨立表頭畫面：`simulator-validation/simulator-window-v0103-favorites-six-container-table.png`。
- 第五筆刷新後畫面：`simulator-validation/simulator-window-v0103-favorites-fifth-after-refresh.png`。
- 完整事件：`simulator-validation/console-v0103-all-scenarios.json`；程序紀錄：`simulator-validation/simulator-v0103.log`。
- 官方 Simulator 已驗證不會降級；實際 G2 顯示仍需安裝 `0.10.3` 後確認。

## `0.10.2` G2 實機表格相容修正

- 使用者安裝 `0.10.1` 後，實際 G2 顯示純文字相容模式；這證明 Simulator 接受的八個文字容器組合在該實機上被拒絕，不能把 `0.10.1` 的 Simulator 截圖當成實機成功。
- `0.10.2` 把常用路線頁降為六個文字容器，與已在實機正常工作的站牌詳情頁使用相同數量級：一個標題、一個更新時間、四個框線資料列。
- 三欄標題合併到第一個框線列的首行，仍維持「到站／路線／方向／站牌」的表格對齊；不再建立獨立欄名與底部說明容器。
- 每 5 秒只更新有變動的列；更新要求會合併，離開常用路線時也會先停止舊頁更新，避免舊容器更新和路線頁重建互相競爭。
- 純文字相容模式仍保留作最後保護，但會明確顯示「相容模式」，方便辨認實機是否仍拒絕六容器版。

2026-07-18 以官方 Simulator `0.8.0`、SDK `0.0.12`、正式 `https://taiwan-bus.0ruka.dev/blobbus` 資料重新冷啟動，並從手機 WebView 實際搜尋 `206`、點星號加入五個站牌及新增第二分組；沒有注入 ETA fixture。

| 頁面／狀態 | 實際操作 | 結果 |
|---|---|---|
| 首頁 | Up、Down、Click | 選項循環並進入常用路線，通過 |
| 常用路線 | Click | 在「常用／分組 2」循環，通過 |
| 常用路線 | Down 四次 | 每次都由事件串流確認送達；選到第五筆「德行東路」，通過 |
| 常用路線 | 等待 7 秒 | ETA 與 `HH:MM:SS` 更新，焦點仍在第五筆，表格未重建到頂端 |
| 常用路線 | Up | 開啟 `206` 方向 `0` 即時路線，通過 |
| `206` 路線 | Up、Down、Click | 站序移動；方向 `0 → 1`，通過 |
| `206` 路線 | Double click | 返回常用路線，通過 |
| 附近站牌 | Up、Down、Click | 開啟「臺北車站(忠孝)」，通過 |
| 站牌詳情 | Up、Down、Click | 開啟當輪即時資料中的 `299` 方向 `1`，通過 |
| `299` 路線 | Up、Down、Click | 站序移動；方向 `1 → 0`，通過 |
| 路線／站牌／附近／首頁 | 逐層 Double click | 依序返回，最後清空 G2 前景頁，通過 |

- App console：`0` 個 error、`0` 次 `favorites table rejected`、`0` 次 `favorite row update failed`。
- 事件紀錄包含至少四次已確認送達的常用路線 Down；本輪共記錄五次 `favorite-row-0` Down 事件（含其他流程操作）。
- 六容器表格：`simulator-validation/simulator-window-v0102-favorites-six-container-table.png`。
- 第五筆經定時更新後仍被選取：`simulator-validation/simulator-window-v0102-favorites-fifth-after-refresh.png`。
- 路線方向切換：`simulator-validation/simulator-window-v0102-favorite-route-after-direction.png`。
- 完整事件：`simulator-validation/console-v0102-all-scenarios.json`；程序紀錄：`simulator-validation/simulator-v0102.log`。
- 這次驗證證明六容器版在官方 Simulator 不會降級；實際 G2 是否接受仍必須安裝 `0.10.2` 後確認，不在此誤列為實機驗證通過。

## `0.10.1` G2 常用路線表格化

- 常用路線不再把五筆內容塞進同一個多行文字區塊；G2 現在使用固定表頭、四個獨立框線列與固定底部手勢列。
- 三欄固定為「到站／路線方向／站牌」，到站狀態改用適合窄欄的短標籤，過長內容會在欄寬內加省略號。
- 選取箭頭、四列分頁與原有手勢狀態保留；每 5 秒只升級四列文字及時間，不重建整頁。
- 若實機拒絕八個文字容器，仍保留單一文字容器備援，手勢捕捉 ID 與名稱維持一致。
- 2026-07-18 在 Simulator 手機 WebView 實際搜尋 `206`，點按星號加入五個正式站牌；沒有修改 App 程式來注入假常用路線，也沒有使用 ETA fixture。

| 頁面 | 實際動作 | 結果 |
|---|---|---|
| 首頁 | 單擊 | 進入「常用路線」 |
| 常用路線 | 下滑四次 | 第五筆「德行東路」成為選取列，四列視窗向下換頁 |
| 常用路線 | 等待超過一輪 5 秒更新 | ETA 與 `HH:MM:SS` 更新，選取仍停在第五筆，沒有跳回第一列 |
| 常用路線 | 上滑 | 開啟 `206`、方向 `0` 的即時路線頁 |
| 路線頁 | 雙擊 | 返回常用路線；第五筆及分頁位置保留 |
| 常用路線 | 雙擊 | 返回首頁 |

- 最終冷啟動執行使用官方 Simulator `0.8.0`、SDK `0.0.12`、正式 `https://taiwan-bus.0ruka.dev` 即時資料，console 為 `0` 個 error。
- Simulator 不支援 GPS bridge，因此仍出現既有位置方法 warning，App 使用預設臺北位置；方向圖的 `raw4` 在 Simulator 被拒絕後由既有 PNG 相容路徑成功顯示，沒有進入文字備援。
- 表格與第五筆更新後畫面：`simulator-validation/simulator-window-v0101-favorites-after-refresh.png`。
- 上滑進入路線：`simulator-validation/simulator-window-v0101-route-from-favorite.png`；雙擊返回：`simulator-validation/simulator-window-v0101-favorites-returned.png`。
- 完整事件與 console：`simulator-validation/console-v0101-all-gestures.json`；程序紀錄：`simulator-validation/simulator-v0101.log`。

### `0.10.1` 全頁面手勢回歸

2026-07-18 再以同一套官方 Simulator `0.8.0` automation API 對所有 G2 頁面執行完整手勢矩陣。第二分組由手機 WebView 的「管理分組 → 新增分組」實際建立；五筆 `206` 常用站牌也由手機搜尋與星號加入，不使用測試 fixture。

| 頁面／狀態 | Up | Down | Click | Double click | 結果 |
|---|---|---|---|---|---|
| 首頁 | 從附近站牌回到常用路線 | 選取附近站牌 | 分別開啟常用路線、附近站牌 | 關閉 G2 前景頁 | 通過 |
| 空白常用分組 | 不誤開路線 | 不產生無效索引 | 循環到「常用」分組 | 返回首頁 | 通過 |
| 有資料常用分組 | 開啟選取的 `206` 即時路線 | 循環選取、跨四列分頁；第五筆後再 Down 回第一筆 | 在「常用／分組 2」間循環 | 返回首頁 | 通過 |
| 常用路線開啟的 `206` | 站序向上 | 站序向下 | 方向 `0 → 1` | 返回常用路線 | 通過 |
| 附近站牌 | 選取回第一站 | 選取下一站 | 開啟「臺北車站(忠孝)」 | 返回首頁 | 通過 |
| 站牌到站詳情 | 路線選取向上 | 路線選取向下 | 開啟 `265區` 方向 `0` | 返回附近站牌 | 通過 |
| 站牌開啟的 `265區` | 站序向上 | 站序向下 | 方向 `0 → 1` | 返回站牌詳情 | 通過 |

- 常用路線第五筆在等待超過一輪 5 秒更新後仍保持選取與分頁位置；ETA 與右上角 `HH:MM:SS` 正常更新。
- `206` 路線雙擊返回後仍保留第五筆；下一次 Down 由第五筆循環回第一筆。
- `265區` 依序雙擊返回站牌詳情，再雙擊返回附近站牌，再雙擊返回首頁；首頁最後一次雙擊後 G2 framebuffer 清空，手機 WebView 留在首頁。
- 兩個路線頁的 `raw4` 均出現 Simulator 既有 `sendFailed`，隨後 PNG 相容格式全部成功，沒有進入文字備援。
- 最終 console 為 `0` 個 error；唯一非圖片格式 warning 是 Simulator 不支援 GPS bridge，App 正常使用預設臺北位置。
- 全部事件：`simulator-validation/console-v0101-all-scenarios.json`。
- 代表畫面：`simulator-validation/simulator-window-v0101-all-favorites-fifth-after-refresh.png`、`simulator-validation/simulator-window-v0101-all-route-from-favorite-after-direction.png`、`simulator-validation/simulator-window-v0101-all-final.png`。

## `0.10.0` Pi5 即時資料代理

- App 的四個正式資料端點改由 `https://taiwan-bus.0ruka.dev/blobbus/` 提供。
- Pi5 代理直接轉送臺北市公共運輸處的 gzip 資料；站牌／路線快取 5 分鐘，到站／車輛資料只快取 2 秒。
- `/health` 提供服務版本與上游狀態資訊；代理不建立假 ETA 或假車牌。
- 2026-07-18 已透過 Pi5 MCP 完成 systemd 安裝、Cloudflare Tunnel ingress、DNS CNAME 與公開 HTTPS 驗證。
- 公開 `/health` 回傳 HTTP 200；四個 gzip 皆通過 `gzip -t` 與 JSON 解碼。
- 當次公開端點實測：28,748 筆站牌、801 筆路線、29,222 筆 ETA、1,321 筆車輛；車輛資料包含真實車牌欄位，例如 `457-FZ`、`458-FZ`。
- 第二次讀取 `GetBusData.gz` 顯示代理快取 `HIT`，且即時端點回應 `Cache-Control: no-store`，確認 App 不會被瀏覽器或 Cloudflare 長期快取舊資料。
- Simulator：`@evenrealities/evenhub-simulator 0.8.0`
- SDK：`@evenrealities/even_hub_sdk 0.0.12`
- 日期：2026-07-18（Asia/Taipei）
- 操作方式：Simulator automation API `/api/input`，不是單元測試或測試資料檔
- 資料：Simulator 直接使用 `https://taiwan-bus.0ruka.dev` 的正式即時資料；GPS bridge 不受 Simulator 支援，因此使用 App 預設臺北位置。

### `/tmp` 原生相容環境

- 唯讀容器無法寫入 `/var/lib/apt` 或安裝系統套件，因此 apt lists、61 個 `.deb`、解壓根目錄、HOME 與 XDG 目錄全部置於 `/tmp`。
- WebKitGTK 2.52.3 在 Xvfb 下實際觸發 `EGL_BAD_PARAMETER`；改用 Ubuntu 24.04 原始發行版的 WebKitGTK／JavaScriptCoreGTK `2.44.0-2` 後成功渲染。
- WebKit helper 的編譯期絕對路徑以等長 binary patch 在 `/tmp` 改指向 `/tmp/w`；Xvfb 的 `xkbcomp` 目錄同樣以等長 patch 改至 `/tmp/xb`。原始套件與系統檔均未修改。
- 容器禁止 X11 Unix socket，因此 Xvfb 使用隔離的 TCP display `127.0.0.1:118`；Simulator automation 使用 `127.0.0.1:9899`。

### `0.10.0` 實際手勢與即時資料結果

| 頁面 | 實際動作 | 結果 |
|---|---|---|
| 首頁 | 下滑、單擊 | 選取並進入「附近站牌」 |
| 附近站牌 | 單擊 | 開啟「臺北車站(忠孝)」 |
| 站牌到站頁 | 下滑五次、單擊 | 選取並開啟 `39` 路線方向 `0` |
| 路線站序頁 | 單擊 | 方向由 `39 0` 切換為 `39 1` |
| 路線站序頁 | 下滑、上滑 | 站序捲動正常，頁面未重建到頂端 |
| 路線站序頁 | 雙擊 | 返回「臺北車站(忠孝)」到站頁 |
| 站牌到站頁 | 雙擊 | 返回附近站牌列表 |

- 最終 console 為 `0` 個 error，並記錄 `ready with 3359 grouped stations`、`open station: 臺北車站(忠孝)`、`open route: 39 0`、`route direction: 39 1`。
- 當輪車輛配對為 direct `491`、pathAttribute `705`、unmapped `95`／`96`、距站超過 500 公尺 `22`。
- 完整 Simulator 畫面確認手機與 G2 都把車牌放在站序最右側；方向 `0` 顯示 `EAL-3790`、`EAL-3778`，切換到方向 `1` 後顯示 `EAL-3791`、`EAL-3786`、`EAL-3787`，右上角資料時間為 `13:18:20`。
- 最終 `npm audit` 對 production 與完整 dependency tree 均回報 `0` 個 info／low／moderate／high／critical vulnerability。
- G2 API framebuffer PNG 在此 headless stack 仍呈純綠色；因此視覺證據使用 X root 完整視窗，console JSON 作為獨立事件證據。
- 方向切換前後：`simulator-validation/simulator-window-v0100-route-before.png`、`simulator-validation/simulator-window-v0100-route-after.png`。
- 首頁畫面：`simulator-validation/simulator-window-v0100-home.png`；完整事件：`simulator-validation/console-v0100-all-gestures.json`；程序紀錄：`simulator-validation/simulator-v0100.log`。

## `0.9.1` 常用路線 ETA 配對修正

- 使用者的手機畫面顯示常用路線資料時間已更新，但所有 ETA 都停在「資料等待中」，證明下載與定時器正常，錯誤發生在資料配對。
- 2026-07-17 21:11:30 的正式資料確認：`GetStop` 使用方向 `0/1`，同 StopID 的 `GetEstimateTime.GoBack` 可能是 `2/3`。
- 修正後先以路線 ID、`GetStop` 方向及邏輯站牌取得精確 StopID，再只用路線 ID＋StopID 取得 ETA，不再用 ETA `GoBack` 做第二次排除。

| 路線 | StopID | Stop 方向 | ETA GoBack | 正式 ETA | 修正後顯示 |
|---|---:|---:|---:|---:|---|
| 北士科1 | 223934 | 0 | 3 | -3 | 末班已過 |
| 206 | 16392 | 0 | 2 | 2052 秒 | 35 分 |
| 280 | 13247 | 0 | 3 | -3 | 末班已過 |
| 280直 | 18409 | 0 | 3 | -3 | 末班已過 |
| 紅15 | 15221 | 0 | 2 | 1140 秒 | 19 分 |
| 通勤9 | 201610 | 0 | 2 | -4 | 今日未營運 |

- `npm run build` 與 0.9.1 版本一致性檢查通過。
- 本次只修改 ETA join，沒有改動 G2 容器或手勢。此執行環境缺少 Simulator 的 WebKitGTK／Xvfb 原生依賴，且平台拒絕下載，因此未把本次資料驗證誤列為 Simulator 手勢驗證；安裝 0.9.1 後仍需在手機／G2 確認正式結果。

## `0.9.2` 最終程式碼審查

- 移除常用頁每 5 秒未使用的 `GetBusData.gz` 請求；站牌到站頁同樣不抓車輛座標，只有需要車牌的路線站序頁下載。
- 合併兩套重複的 ETA 索引與時間更新程式，並以 station map 取代常用路線的重複線性站牌查找。
- 合併手機與 G2 的常用路線開啟流程，以及手機點分組與 G2 循環分組的重複狀態寫入流程。
- 加入更新 epoch：離開頁面後，舊請求不再更新新頁面；快速返回時也不會建立失去作用的 5 秒計時器。
- 手機站牌到站頁與路線站序頁在週期更新後明確恢復捲動位置。
- TypeScript `strict`、未使用變數／參數檢查、正式 Build 與版本一致性檢查均需在最終打包命令中通過。

## `0.9.3` 車牌路線配對修正

- 2026-07-17 23:37:20 的正式 `GetBusData.gz` 有 527 輛狀態與方向可用的車輛；舊程式只用 `RouteID` 直接查 `GetStop.routeId`，因此只匹配 209 輛。
- 正式 `GetRoute.gz` 證實另外 228 輛的 `RouteID` 實際對應 `pathAttributeId`。App 現在保留直接 route ID 優先，找不到時再以無歧義的 `pathAttributeId → Id` 對照表正規化。
- 正規化後 437 輛可找到相符的路線與方向；其中 16 輛距最近站仍超過 500 公尺而被排除，最後 421 輛會顯示在對應站序，覆蓋率由 39.7% 提升至 79.9%。其餘 90 輛來源 `RouteID=0`，沒有足夠資料可可靠掛到路線，因此不顯示。
- 正式資料抽查：`739-FW` 由 `102630` 正規化到路線 `10263`，對應「行義路」61 公尺；`039-U5` 由 `112430` 正規化到路線 `11243`，對應「格致中學(自強路)」32 公尺；`292-FM` 由 `108720` 正規化到路線 `10872`，對應「南京建國路口」15 公尺。
- `pathAttributeId` 衝突時不猜測、不建立別名；車牌以路線＋方向限制後才依座標找最近站，超過 500 公尺不顯示，避免把回廠或異常座標的車輛掛錯站。
- TypeScript strict 與正式 Vite build 已通過。此執行環境仍缺少 `libwebkit2gtk-4.1.so.0`、`libjavascriptcoregtk-4.1.so.0`、`libsoup-3.0.so.0` 和 Xvfb，無法啟動官方 Simulator；本節只記錄正式資料配對驗證，不宣稱 Simulator 畫面驗證。
- 原始核對結果：`simulator-validation/vehicle-mapping-v093.json`；Simulator 啟動失敗紀錄：`simulator-validation/simulator-v093-startup.log`。

## `0.7.0` 全部手勢基準

| 頁面 | 手勢 | Simulator 證據 | 結果 |
|---|---|---|---|
| 附近站牌 | 下滑 | `currentSelectItemIndex: 1` | 通過 |
| 附近站牌 | 上滑 | 回到索引 `0` 後單擊開啟第一項 | 通過 |
| 附近站牌 | 單擊 | 開啟「臺北車站(忠孝)」 | 通過 |
| 附近站牌 | 雙擊 | 關閉頁面；再次單擊得到 `no active event container` | 通過 |
| 站牌到站頁 | 下滑 | `arrival-row-0`, `eventType: 2` | 通過 |
| 站牌到站頁 | 上滑 | `arrival-row-0`, `eventType: 1` | 通過 |
| 站牌到站頁 | 單擊 | 開啟 652 路線，方向 `1` | 通過 |
| 站牌到站頁 | 雙擊 | 返回附近站牌列表 | 通過 |
| 路線站序頁 | 下滑 | `route-row-0`, `eventType: 2` | 通過 |
| 路線站序頁 | 上滑 | `route-row-0`, `eventType: 1` | 通過 |
| 路線站序頁 | 單擊 | 652 路線方向由 `1` 切換成 `0` | 通過 |
| 路線站序頁 | 雙擊 | 返回「臺北車站(忠孝)」到站頁 | 通過 |

## 車牌位置驗證

- `0.7.1` 使用 Simulator 實際開啟「臺北車站(忠孝)」的 299 路線，並等待超過一輪 5 秒更新。
- App 同時下載即時 `GetBusData.gz`，以路線、方向及車輛座標對應最近站序。
- 手機路線頁把 `KKB-1816`、`KKB-1785` 固定在站序列最右側；G2 把 `KKB-1785` 顯示在該列最右側。
- 完整 Simulator 視窗保存在 `simulator-validation/simulator-v071-plate-right.png`。
- 在該路線頁實際執行下滑、上滑、單擊切換方向及雙擊返回，Simulator 均收到對應事件；原始紀錄為 `simulator-validation/console-v071-all-gestures.json`。

## 雙方向反白驗證

- `0.8.0` 在 G2 路線頁使用兩個 288×42 圖片方向按鈕，同時顯示「往永春高中」與「往新莊」。
- 初始方向「往新莊」呈現綠底黑字，另一方向維持黑底綠字：`simulator-validation/simulator-v080-direction-before.png`。
- 以 Simulator 實際送出單擊後，方向切換為 `299 0`，反白同步移至「往永春高中」：`simulator-validation/simulator-v080-direction-after.png`。
- 等待超過一輪 5 秒更新後，再實測下滑、上滑與雙擊返回；事件均正常且沒有圖片更新錯誤。

## `0.8.1` 實機相容修正

- 使用者提供的 `0.8.0` G2 實機照片顯示「● 往…｜○ 往…」文字列，證明圖片更新未成功並觸發文字備援；Simulator 畫面不能代表實機圖片傳輸一定成功。
- `0.8.1` 在頁面建立後延遲送圖，PNG 失敗時重試三次，再依 SDK 文件改送灰階像素兩次，全部失敗才進入文字備援。
- 成功後快取目前方向；每 5 秒 ETA 更新不再重送方向圖片，只有進入頁面或切換方向才更新。
- 最終 Simulator 等待 18 秒後僅記錄初始兩張 PNG 成功；單擊切換後各更新一次，沒有隨 ETA 重複送圖：`simulator-validation/console-v081-all-gestures.json`。
- Simulator 最終畫面：`simulator-validation/simulator-v081-final.png`。灰階備援仍需安裝 `0.8.1` 後由 G2 實機確認。

## `0.8.2` 官方規格修正

- 使用者安裝 `0.8.1` 後，G2 實機仍顯示「● 往…｜○ 往…」文字備援，表示前版重試並沒有處理真正的參數不相容。
- 對照 Even Realities 官方 `glasses-ui` 規格後，確認圖片容器名稱上限為 16 字元；前版 `route-direction-0/1` 是 17 字元。Simulator 0.8.0 仍接受這組名稱，因此先前只在 Simulator 成功。
- 方向圖片容器改為 `dir-tab-0/1`，兩者均為 9 字元，而且建立與更新使用完全相同的 ID／名稱。
- 圖片管線改成官方 image template 相同的 `canvas.toBlob('image/png')` → `Uint8Array`；移除未編碼灰階像素備援。
- 所有方向圖片更新共用單一 Promise 佇列；同時間只允許一個 `updateImageRawData`，頁面重建與文字更新也會等待圖片傳輸完成。
- Simulator 實際開啟「臺北車站(忠孝)」的 299 路線，初始方向圖成功為 `dir-tab-0 3680 bytes`、`dir-tab-1 2779 bytes`，零重試。
- 實際執行下滑、上滑、單擊後，方向由 `1` 切到 `0`，兩張方向圖再次成功且反白移至「往永春高中」。等待超過一輪 5 秒更新後沒有重送圖片。
- 實際雙擊由路線頁返回站牌到站頁，再雙擊返回附近站牌列表。最終紀錄為 0 個 error、0 次 image retry、4 次 image success。
- 修正前後畫面：`simulator-validation/simulator-v082-direction-before.png`、`simulator-validation/simulator-v082-direction-after.png`。G2 實機結果仍需安裝 `0.8.2` 後確認。

## `0.8.3` 實機／Simulator 圖片格式分流

- 使用者安裝 `0.8.2` 後，G2 實機仍顯示文字備援；這排除了「只有容器名稱過長」的診斷。
- 專案安裝的官方 `@evenrealities/even_hub_sdk 0.0.12` README 指定實機圖片資料為灰階 bytes，並說 SDK 內部會以 LZ4 壓縮；型別註解建議傳 `number[]`。官方 Simulator 0.8.0 實際上則把輸入當成編碼圖片解碼。
- `0.8.1` 的灰階備援使用 0／255，並不是 G2 4-bit 顯示需要的每像素 0–15；`0.8.2` 又移除了灰階資料，只剩 PNG。因此兩版均沒有同時符合實機與 Simulator。
- `0.8.3` 從 Canvas 產生兩份相同畫面：每像素 0–15 的 `raw4 number[]` 先送實機；若宿主拒絕，再送 PNG `Uint8Array` 給 Simulator／相容宿主。
- 只有兩種格式都失敗才進入文字備援；失敗時手機路線頁會顯示完整的 G2 回傳狀態，下一次可直接辨別 `imageSizeInvalid`、`imageToGray4Failed` 或 `sendFailed`。
- Simulator 實際開啟「臺北車站(忠孝)」的忠孝幹線：兩個 `raw4` 都如預期回傳 `sendFailed`，隨後兩個 PNG 成功，沒有進入 fallback。
- 實際執行下滑、上滑、單擊切換方向、等待超過一輪 5 秒更新，再雙擊返回；0 個 error、0 次 fallback。
- 畫面：`simulator-validation/simulator-v083-route.png`、`simulator-validation/simulator-v083-direction-after.png`；完整紀錄：`simulator-validation/console-v083-final.json`。G2 實機的 `raw4` 成功狀態仍需安裝 `0.8.3` 後確認。

## `0.8.4` 同名道路兩側站位合併

- 正式資料確認「蘭雅國中」不是重複列：`stopLocationId` 963 與 539 是道路兩側的兩個實體站位，座標相距約 35 公尺；官方即時站牌頁也分別以兩個 ID 提供資料。
- 附近列表改為同名正規化後完全相符、且任一座標相距不超過 80 公尺才合併。合併後保留所有實體 stop ID、方向與路線，顯示距離取最近的一側。
- Simulator 目標重現包含 3 個實體站位，其中蘭雅國中兩側各含兩條路線。Console 實際輸出 `station clustering: 3 physical -> 2 logical` 與 `ready with 2 grouped stations`。
- 手機與 G2 Simulator 列表只各顯示一個「蘭雅國中」，其路線聯集為 `203, 268`：`simulator-validation/simulator-v084-cluster-window.png`。
- 實際以 automation API 執行下滑、上滑、下滑後單擊，成功開啟「蘭雅國中」：`simulator-validation/simulator-v084-cluster-detail-window.png`。再雙擊後返回附近列表：`simulator-validation/simulator-v084-cluster-return-window.png`。
- 本輪執行環境的網路白名單會中斷政府 Blob 下載，因此 Simulator 使用從正式資料確認的 963／539 座標製作最小重現；驗證檔保留於 `simulator-validation/v084-stop-cluster-fixture.json`，不包含在 EHPK。

## `0.8.4` 當輪修正

1. `0.8.4` 把同名且 80 公尺內的道路兩側實體站位合併成一個附近站牌。
2. 路線、stop ID、方向與 ETA 查詢資料完整保留，列表距離取最近的實體站位。
3. 完成 Simulator 下滑、上滑、單擊進入與雙擊返回操作；列表不再顯示兩個蘭雅國中。

完整原始資料：

- `simulator-validation/console-v083-all-gestures.json`
- `simulator-validation/console-v083-final.json`
- `simulator-validation/simulator-v083-route.png`
- `simulator-validation/simulator-v083-direction-after.png`
- `simulator-validation/simulator-v083.log`
- `simulator-validation/console-v084-cluster.json`
- `simulator-validation/console-v084-gestures.json`
- `simulator-validation/simulator-v084-cluster-window.png`
- `simulator-validation/simulator-v084-cluster-detail-window.png`
- `simulator-validation/simulator-v084-cluster-return-window.png`

Simulator 0.8.0 不提供 GPS bridge，因此定位測試使用 App 原有的預設臺北回退；這不影響手勢及頁面流程。
