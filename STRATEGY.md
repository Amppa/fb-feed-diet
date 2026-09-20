# FB Diet — 分類策略與實驗記錄（STRATEGY.md）

> 本文件是分類規則的「實驗筆記」：記錄已嘗試過的方式、參考對象（esuit-suggest-blocker）的做法、每個決策的原因，以及誤判發生時的診斷流程。之後再遇到誤判／漏判，先查這份文件，不要從頭找。

---

## 1. 參考對象：esuit-suggest-blocker v2.10.0 的分類方式

來源：`../esuit-suggest-blocker/Development.md`（逆向筆記）。esuit 只在首頁（`pathname === '/'`）運作，分類器 `classifyFeedUnit(o)` 的規則：

| 分類 | esuit 的判定 |
|---|---|
| GROUP_YOU_MIGHT_LIKE | `unitTypename ∈ ['GroupsYouShouldJoinFeedUnit']` |
| SUGGESTED | `subscribe_status === 'CAN_SUBSCRIBE'`（路徑 `^^actors[0].subscribe_status`）或 `viewer_forum_join_state === 'CAN_JOIN'` |
| SPONSORED | `sponsored_data.ad_id` 存在（路徑 `^sponsored_data.ad_id`） |
| REELS | nested unit 的 `showcase_story_type === 'SHOWCASE_SHORT_VIDEO'` |
| SUGGESTED（header 版） | nested unit 的 `story_header{"location":"homepage_stream"}` 下的 `title.text` 存在 |

特點：
- 只查 Relay store（`window.___sf(id, path)`），不讀 props。
- if 短路順序：社團 → suggested → sponsored → reels/story_header。
- 其餘（Stories 托盤、Marketplace 卡、搜尋廣告、右欄）是靠**元件名稱裝飾**（14 個 Comet 元件名單），不是 feed unit 分類。

---

## 2. fb-diet 現行做法（與 esuit 的差異）

- 分類器 `src/inject/classify.js`：props 優先 → Relay store 後備；evidence 全收集後在 `pickCategory` 用固定優先序挑分類（sponsored > suggestedGroup > suggested > reels）。
- 分類粒度更細：`suggested` 與 `suggestedGroup` 分開設定；額外有 `stories / marketAds / searchingAds` 分類（但由 fold.js 的元件名單直接標記，非分類器判定）。
- **不限首頁**；有 debug evidence 記錄（`unknown` 會回報完整 evidence）。
- Reels 判定刻意比 esuit 保守（見下方決策 #3）。

### 現行規則一覽（classify.js）

| 分類 | 判定 | 來源 |
|---|---|---|
| sponsored | `sponsored_data.ad_id` 存在 | props / Relay `^sponsored_data.ad_id` |
| suggestedGroup | `unitTypename ∈ ['GroupsYouShouldJoinFeedUnit','GroupSuggestionsFeedUnit']` 或 `viewer_forum_join_state === 'CAN_JOIN'` | props / Relay |
| suggested | `subscribe_status === 'CAN_SUBSCRIBE'`（**只有這一個值**） | Relay `^^actors[0].subscribe_status` |
| suggested | ~~story_header~~（決策 #6：已退役；`storyLocation`/`storyTitle` 僅為診斷欄位） | 備份：`classify-retired.js` |
| reels | 單元**本身** `__typename === 'ShowcaseFeedUnit'`（排除附件模組 context） | props |
| stories / marketAds / searchingAds | 元件名稱直接標記（fold.js `FEED_UNIT_MODULES`） | — |

---

## 3. 決策記錄（已實驗過的方式）

### 決策 #1 — `subscribe_status` 只認 `CAN_SUBSCRIBE`
- **已嘗試並否決**：把 `CAN_FOLLOW`、`NOT_SUBSCRIBED` 也納入 suggested。
- **結果**：`NOT_SUBSCRIBED` 命中幾乎所有未訂閱作者（社團文章作者、被留言者、粉專），把朋友留言回應、朋友對社團文章留言誤折成 suggested（誤判 1、2）。
- **結論**：與 esuit 一致，只留 `CAN_SUBSCRIBE`。

### 決策 #2 — `story_header` 必須是「已知建議 location + 非空 title」
- **已嘗試並否決**：(a) location-free 的 `^story_header.^title.text`；(b) `^story_header{$1}` 只查存在不查 title；(c) `^story_header` 存在即判 `header`。
- **結果**：「朋友對某篇文章留言」、「朋友對社團文章留言」這類**情境式 story** 本來就帶 story_header（不含 location 參數），(a)(c) 直接命中 → 誤折（誤判 1、2）。(b) 讓無 title 的 header 也中。
- **結論**：~~只有 `homepage_stream / groups_tab / feed` 三個 location key 下讀到非空 title 才算 suggested 證據。~~ → **已被決策 #6 取代**：整條 story_header 規則於 2026-09-19 退役（備份：`src/inject/classify-retired.js`）。

### 決策 #6 — story_header 完全不作為分類證據（2026-09-19，probe 實證）
- **已嘗試並否決**：esuit 的「`story_header{location:homepage_stream}` 下有 `title.text` 即判 suggested」，以及我們前兩輪的加強版（location-free 後備／存在即中／已知 location + 非空 title）。
- **probe 實證**：朋友照片被留言回應的情境式 story（標題「Sunny Lin 最近留言回應。」）存在與建議標題**完全相同**的 record：`client:1238:story_header(location:homepage_stream):title`（誤判 4）。標題多語言、格式多變，字串比對無法可靠區分。
- **結論**：story_header 相關規則全數退役，只保留 `storyLocation` / `storyTitle` 作為診斷欄位。suggested 回歸 esuit 核心：**關係狀態**（`CAN_SUBSCRIBE` / `CAN_JOIN` / 社團 typename）+ 元件名單。代價：「為你推薦」內容貼文可能漏折（會以 unknown 進入 log，等 probe 收集到建議貼文獨有訊號再補）。
- **程式碼備份**：`src/inject/classify-retired.js`（未被 manifest 載入；含所有退役規則的可執行版本與重啟步驟）。

### 決策 #3 — Reels 只認「單元本身是 ShowcaseFeedUnit」
- **已嘗試並否決**：(a) `showcase_story_type === 'SHOWCASE_SHORT_VIDEO'` 即判 reels（esuit 做法）；(b) typename 從 Relay record / nested record 回退讀取。
- **結果**：(a) 朋友**轉貼** reel 的普通 Story 也帶此欄位 → 誤折（誤判 3 前身）；(b) 朋友轉貼的 reel **附件 record 本身**是 `ShowcaseFeedUnit`，經 `CometFeedStoryFBReelsAttachmentStyle.react` 送進分類器後被誤判（誤判 3）。
- **結論**：雙重防護——`ownTypename`（payload 自帶 typename / feedUnit 直接 `__typename`）才觸發 reels 規則；且 `context.moduleName === 'CometFeedStoryFBReelsAttachmentStyle.react'` 時一律不折 reels。真正的 Reels 面板由 `FBReelsTopOfFeedTrayTile` / `FBReelsRootWrapper` 元件名單覆蓋，不經分類器。

### 決策 #4 — Relay store 捕捉：Proxy construct trap 而非字串改寫
- esuit 用 CSP 放寬 + inline `<script>` 字串替換 `RelayPublishQueue`，把 store 塞進 `window.___rs`。
- fb-diet 主路徑是 Proxy 包 `RelayRecordSourceProxy` 建構子（免 eval、不受 CSP 限制），同時**保留** `window.___rs` 全域 fallback（`relay.js checkGlobalStore()`），且 proxy.js 也註冊了 RelayPublishQueue source hook。兩條路都通。

### 決策 #5 — 處理方式：摺疊可還原 vs 1x1 隱藏
- esuit 用 1x1 透明容器（避免 IntersectionObserver 崩潰）；fb-diet 用 squash 隱藏 + 可展開還原的 placeholder bar。維持 fb-diet 方式。

---

## 4. 已知誤判案例（症狀 → 根因 → 修正）

| # | 症狀 | 根因（命中規則） | 修正 |
|---|---|---|---|
| 1 | 朋友對某篇文章（自己圖片）留言回應被判 suggested | `story_header:header`（location-free 後備）及／或 `subscribe_status: NOT_SUBSCRIBED` | 決策 #1、#2 |
| 2 | 朋友對公開社團文章留言回應被判 suggested | 同上（社團作者未訂閱 → NOT_SUBSCRIBED 命中） | 決策 #1、#2 |
| 3 | 朋友轉貼含 reel 被判 reels | `unitTypename:ShowcaseFeedUnit`（nested 附件 record 的 typename） | 決策 #3 |
| 4 | 朋友照片被留言回應（「X 最近留言回應。」情境 story）被判 suggested | `story_header:homepage_stream`（與建議標題同一個 keyed record，probe 實證） | 決策 #6（規則全數退役） |

> 注意修正後的副作用：**寧可漏折、不可誤折**。如果發現某些「真的建議貼文」開始漏折，先看 `unknown` 回報的 evidence（見 §5），有資料再精準補規則，不要直接放寬上述條件。

---

## 5. 診斷工具與 runbook（遇到漏判／誤判時）

1. **診斷日誌（自動、持久）**：`chrome.storage.local` 的 `fbDietLog` key，記錄最近 300 筆分類事件（blocked / unknown，含 category、reason、unitTypename、moduleName、evidence、頁面路徑）。
   - Facebook 分頁 Console（選 content script context）：`__fbDietDumpLog()`、`__fbDietClearLog()`。
2. **Feed 診斷按鈕（probe，手動）**：Options 開啟「🧪 顯示 Feed 診斷按鈕」（或 URL 加 `?fb_diet_debug=1`），每個經過 `FBDietFold` 的單元右上角出現 ⧉ 按鈕，點擊即複製該單元的完整 JSON：分類結果（category/reason/evidence）、觸發的元件模組、payload 快照（深度 5）、Relay record 欄位。
   - **漏判診斷**：對沒被摺疊的貼文按 ⧉，看 `classify.category` 是 `null`（unknown，看 reason）還是被 settings 關掉；把 JSON 貼給對照 §3 補規則。
   - **誤判診斷**：對被誤折的貼文展開後按 ⧉，看 `reason` 對回 §3 的哪條規則。
3. **Options Debug 卡（報告判讀）**：Options 頁面底部的 DEBUG 卡可貼上 probe 複製的 JSON，按「判斷」即顯示當時分類結果，並用**目前版本規則**對 `payload` 重跑一次分類做對比。已知限制：probe 快照只含第一筆 record，`^` / `^^` 連結路徑在重跑時讀不到值（結果可能退化為 unknown），此時以當時結果為準。
4. **即時 console**：URL 加 `?fb_diet_debug=1`，看 `[FB Diet][MAIN]` / `[FB Diet][Classify]` 輸出。
5. **單元測試**：`npm test`；新規則務必補 `tests/classify.test.js` 迴歸測試。

### 新增規則的安全流程
1. 從 unknown 的 evidence（或 probe JSON）找出候選 Relay path / typename。
2. 確認該證據**不會**命中正常朋友貼文（在多個情境下驗證）。
3. 加到 `pickCategory` 的優先序中（廣告 > 社團 > 建議 > reels）。
4. 補測試（正向 + 至少一個「朋友貼文不得命中」的反向測試）。
5. 在本文件 §3 追加一條決策記錄。
