# FB Diet — 分類策略與實驗記錄（STRATEGY.md）

> 本文件是分類規則的「實驗筆記」：記錄已嘗試過的方式、參考對象（esuit-suggest-blocker）的做法、每個決策的原因，以及誤判發生時的診斷流程。之後再遇到誤判／漏判，先查這份文件，不要從頭找。

---

## 1. 參考對象：esuit-suggest-blocker v2.10.0 的分類方式

esuit 只在首頁（`pathname === '/'`）運作，分類器 `classifyFeedUnit(o)` 的規則：

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

- 分類器 `src/inject/classify.js`：props 優先 → Relay store 後備；evidence 全收集後在 `pickCategory` 用固定優先序挑分類（sponsored > suggestedGroup > suggested > stories > reels）。
- 分類粒度更細：`suggested` 與 `suggestedGroup` 分開設定；額外有 `stories / marketAds / searchingAds` 分類（`marketAds / searchingAds` 由 fold.js 的元件名單直接標記；`stories` 以元件名單為主、加上分類器的 `DiscoverFeedUnit` typename 規則，見決策 #7）。
- **不限首頁**；有 debug evidence 記錄（未命中規則的 `regular` 會回報完整 evidence）。
- Reels 判定刻意比 esuit 保守（見下方決策 #3）。

### 現行規則一覽（classify.js）

| 分類 | 判定 | 來源 |
|---|---|---|
| sponsored | `sponsored_data.ad_id` 存在 | props / Relay `^sponsored_data.ad_id` |
| suggestedGroup | `unitTypename ∈ ['GroupsYouShouldJoinFeedUnit','GroupSuggestionsFeedUnit']`（僅橫式「推薦你加入的社團」列表，歸 other 群組） | props / Relay |
| suggested | `subscribe_status === 'CAN_SUBSCRIBE'`（**只有這一個值**）；或 `viewer_forum_join_state === 'CAN_JOIN'`（未加入社團的推薦貼文，決策 #10） | Relay `^^actors[0].subscribe_status` / `^to.viewer_forum_join_state` |
| suggested | ~~story_header~~（決策 #6：已退役；`storyLocation`/`storyTitle` 僅為診斷欄位） | 備份：`classify-retired.js` |
| reels | 單元**本身** `__typename === 'ShowcaseFeedUnit'`（排除附件模組 context） | props |
| stories | 單元**本身** `__typename === 'DiscoverFeedUnit'`（動態中間的限時動態列，決策 #7）；其餘 stories 表面仍由元件名單標記 | props |
| marketAds / searchingAds | 元件名稱直接標記（fold.js `FEED_UNIT_MODULES`） | — |

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
- **結論**：story_header 相關規則全數退役，只保留 `storyLocation` / `storyTitle` 作為診斷欄位。suggested 回歸 esuit 核心：**關係狀態**（`CAN_SUBSCRIBE` / `CAN_JOIN` / 社團 typename）+ 元件名單。代價：「為你推薦」內容貼文可能漏折（會以 `regular`（reason: `no-match`）進入 log，等 probe 收集到建議貼文獨有訊號再補）。
- **程式碼備份**：`src/inject/classify-retired.js`（未被 manifest 載入；含所有退役規則的可執行版本與重啟步驟）。

### 決策 #7 — 動態中間的限時動態列：`DiscoverFeedUnit` → stories（2026-09-21，probe 實證）
- **症狀**：首頁動態 position 9~10 插入的限時動態列未被摺疊，probe 回報 `reason: no-match`、`unitTypename: DiscoverFeedUnit`、`moduleName: CometFeedUnitErrorBoundary.react`。
- **根因**：stories 分類原本只靠 fold.js 元件名單（`StoriesTray*.react` / `CometStoriesTray.react`），但這種動態中間的限時動態列走**通用** `CometFeedUnitErrorBoundary.react` 包裝，元件名單看不到它，分類器又沒有對應規則。
- **證據**：2 筆 probe（position 9、10，`CometModernHomeFeedQuery`、`renderLocation: homepage_stream`），Relay record 皆為 edges connection（一排卡片），符合橫向限時動態列結構；且無 `sponsored_data` / `actors` / story_header 等一般貼文欄位。
- **規則**：`ownTypename === 'DiscoverFeedUnit'` → stories，與 reels 相同只認**單元本身**的 typename（nested record 不算）。優先序排在 suggested 之後、reels 之前。
- **已知風險**：`DiscoverFeedUnit` 名稱上可能涵蓋其他「探索型」插入面板；目前無反例，若日後發現誤折（probe 看 `reason: unitTypename:DiscoverFeedUnit`），再改用 position 或 Relay 欄位收緊。

### 決策 #8 — 兩層分類架構：細粒度 category → 使用者群組（2026-09-21）
- **動機**：category 多達 7 種，對使用者太細。設定頁、folded bar、統計改以 5 個「群組」呈現，分類器與 storage 完全不變。
- **群組映射**（`defaults.js` `GROUP_BY_CATEGORY`；fold.js 自帶一份 MAIN-world 副本）：
  - `ads`：sponsored + marketAds + searchingAds
  - `regular`：regular（no-match；**永遠不可摺疊**，群組僅供統計，無設定開關）
  - `suggested`：suggested
  - `media`：reels + stories
  - `other`：suggestedGroup
- **運作方式**：群組是純「顯示與操作層」。Options 群組開關批次寫入映射的 per-category key（`SETTING_KEYS_BY_GROUP`）；「群組內全部開啟」才顯示為開。統計仍按 category 累計，顯示時加總。folded bar 顯示群組名；probe 氣泡與 Options 分析器同時顯示 type + group。
- **命名（Phase A 暫定）**：`regular` 群組顯示為「一般貼文」。未來 Phase B 若用 probe 驗證出「朋友 vs 陌生人」「已追蹤 vs 未追蹤粉專」的可靠訊號，再把陌生人貼文從 regular 移到 suggested 群組，屆時 regular 群組更名「我認識的、追蹤的貼文」。所有關係欄位規則必須照 §5 安全流程驗證（決策 #1、#2 的教訓）。
- **取捨**：使用者失去單一 category 的獨立開關（例如只想折 marketplace ad）；若日後有需要，可在群組下加進階子選項。

### 決策 #10 — CAN_JOIN 貼文歸 suggested、僅 GYSJ 列表歸 suggestedGroup（2026-09-21，probe 實證）
- **症狀**：動態中「可加入社團」的推薦**貼文**（`__typename: Story` + `to.viewer_forum_join_state: CAN_JOIN`）被歸 `suggestedGroup` → other 群組；依兩層架構（決策 #8）它應屬於 suggested → Facebook 推薦群組。
- **規則**：`viewer_forum_join_state === 'CAN_JOIN'` → `suggested`（reason: `to.viewer_forum_join_state`）；只有橫式「推薦你加入的社團」列表（`GroupsYouShouldJoinFeedUnit` 等 typename）→ `suggestedGroup`。
- **注意**：CAN_JOIN 只在「未加入」的社團貼文上出現，與決策 #1 的 subscribe_status 教訓不同——它是單元本身的屬性（`^to.viewer_forum_join_state`），不是 actors 的訂閱狀態，誤傷面小；3 筆 probe 皆為 Story + CAN_JOIN。

### 決策 #3 — Reels 只認「單元本身是 ShowcaseFeedUnit」
- **已嘗試並否決**：(a) `showcase_story_type === 'SHOWCASE_SHORT_VIDEO'` 即判 reels（esuit 做法）；(b) typename 從 Relay record / nested record 回退讀取。
- **結果**：(a) 朋友**轉貼** reel 的普通 Story 也帶此欄位 → 誤折（誤判 3 前身）；(b) 朋友轉貼的 reel **附件 record 本身**是 `ShowcaseFeedUnit`，經 `CometFeedStoryFBReelsAttachmentStyle.react` 送進分類器後被誤判（誤判 3）。
- **結論**：雙重防護——`ownTypename`（payload 自帶 typename / feedUnit 直接 `__typename`）才觸發 reels 規則；且 `context.moduleName === 'CometFeedStoryFBReelsAttachmentStyle.react'` 時一律不折 reels。真正的 Reels 面板由 `FBReelsTopOfFeedTrayTile` / `FBReelsRootWrapper` 元件名單覆蓋，不經分類器。

### 決策 #4 — Relay store 捕捉：Proxy construct trap 而非字串改寫
- esuit 用 CSP 放寬 + inline `<script>` 字串替換 `RelayPublishQueue`，把 store 塞進 `window.___rs`。
- fb-diet 主路徑是 Proxy 包 `RelayRecordSourceProxy` 建構子（免 eval、不受 CSP 限制）。`window.___rs` 的讀取路徑保留作為外部相容 fallback（若其他工具設定該變數仍可讀），但本擴充功能不再主動填入它（見決策 #9）。

### 決策 #9 — 移除 CSP 放寬與 RelayPublishQueue source hook（2026-09-21，穩定性修正）
- **症狀**：間歇性「FB 頁面載入不進來」，console 停在最後一條 `[FB Diet][MAIN] Successfully source-patched module: RelayPublishQueue`。
- **根因**（兩個高風險機制）：
  1. `rules.json` 用 declarativeNetRequest 把 Facebook 回應的 CSP **整份替換**成硬編碼副本（只為塞入 `'unsafe-eval'`）。FB 的資源網域經常變動，過時的網域白名單會擋掉新資源 → 間歇性載入失敗。
  2. source hook 在 `__d` 層把模組 factory `toString()` 後用 inline script / eval 重編譯執行，只為把 store 指到 `window.___rs`。重編譯強制 `'use strict'`、可能拋錯，且與原 factory 產生雙重執行競爭。
- **關鍵事實**：兩者皆非必要——`RelayPublishQueue` 內部 `new` 出來的 store 正是 `RelayRecordSourceProxy` 的實例，construct trap（決策 #4 主路徑）本來就會捕捉到同一個 store。
- **修正**：刪除 `rules.json` 與 `declarativeNetRequest` 權限；刪除 proxy.js 的 source hook / `compileFunctionString` / inline-script 編譯；分類改為完全依賴 construct trap（`window.___rs` 讀取保留為外部 fallback）。
- **驗證**：重載後 console 應**不再**出現 source-patch 訊息；`FBDietRelay.isReady()` 應為 true、分類 evidence `source` 仍為 `relay`。

### 決策 #5 — 處理方式：摺疊可還原 vs 1x1 隱藏
- esuit 用 1x1 透明容器（避免 IntersectionObserver 崩潰）；fb-diet 用 squash 隱藏 + 可展開還原的 placeholder bar。維持 fb-diet 方式。

### 決策 #11 — probe 精簡：保留證據、移除雜訊（2026-09-22）
- **問題**：probe JSON 夾帶三種雜訊——(a) 完整 payload 內含 query variables（`__fragmentOwner.variables` 數十個 `__relay_internal__pv__*`）、React 內部結構（context / memo / fragments）；(b) 完整 Relay record dump 是不透明 store 結構（`__sources` / `__mutator` / `handle` 陣列），無欄位語意；(c) 對診斷（作者？社團？內容？關係狀態？分類器到底讀了什麼？）沒有直接幫助。
- **保留（重要）**：`classify` 決策全文（category / reason / evidence）、`enrichment`（作者 id / name / typename / subscribe_status；社團 id / name / join_state；內容 message 片段 / permalink / created_time；媒體 count / types / isMultiImage / hasVideo；viewer id）、`relayReads`（分類器對此單元實際嘗試的 Relay paths 與回傳值——分類器每讀一個 path 就記一筆 `safeRelayRead`）。
- **移除（雜訊）**：payload 只留單元身份（`__typename` / `__id` / `post_id`）；Relay record dump 不再內嵌（舊報告的 `relayRecord` 在分析器重跑時仍相容，視為單 record 快照）。
- **實作**：`metadata.js`（獨立模組，MAIN world，manifest 在 classify 之前載入）+ fold.js `buildUnitProbeReport` 精簡 + classify.js `relayReads` 讀取日誌 + `getLastRelayReads()`；浮動氣泡新增「作者／社團」行。
- **注意**：「加入／追蹤按鈕文字」與「多圖片版面」等 DOM 視覺訊號刻意不收：React 樹不可解析（iphonE 註記），以 Relay 欄位為準。

### 決策 #13 — Probe v2 設計：去重瘦身、NULL 標記與全方位除錯上下文（2026-09-22）
- **核心理念**：日常過濾極致高效；出包（誤判／漏判）時收集足夠資訊以供再次開發，且去除重複與冗餘欄位。
- **欄位精簡與去重**：
  1. 單一事實來源：頂層 `unitTypename` 與 `payload.feedUnit.__typename` 刪除，僅保留 `classify.unitTypename`。
  2. `payload.feedUnit` 僅留 `post_id`（定位用），刪除重複的 `__id` 與 `__typename`。
  3. `classify.evidence` 刪除 `ids`（改為 `id` 與 `idCount`）、`storyType`、`storyLocation`、`storyTitle` 等舊欄位。
- **語意上下文強化（enrichment）**：
  1. `actor`：保留 `id`、`name`、`typename`、`subscribeStatus`。
  2. `group`：保留 `id`、`name`、`joinState`，並新增 `permalink`（社團完整網址）。
  3. `content`：包含 `permalink`（優先取自 Relay，fallback 以 actor.id + post_id 組成）、`message`（120 字）、`title`（原 storyTitle 專屬收攏位置）、`createdTime`（原始時間戳）、`createdAt`（人類可讀 ISO 時間字串）、`callToAction`（廣告行動按鈕）、`feedContext`（好友按讚留言情境脈絡）、`isReshare`（轉貼識別）。
  4. `media`：`types` 陣列去重。
  5. `viewer`：以 `isSelf`（布林值或 null）取代 viewer.id。
- **全維度除錯支援**：頂層包含 `href`（頁面網址，區分首頁/社團/Watch）、`version`（擴充版本）、`settings`（當時過濾開關快照）、`relayReads`（路徑與值日誌）、`recordKeys`（Relay 記錄頂層鍵值清單，防範臉書改版新欄位盲區）。
- **氣泡顯示規範**：
  - 關係行：顯示 `subscribeStatus / joinState`，無值顯式標記 `NULL`。
  - 標題行：`message` 優先顯示前 40 字；無 message 則取 `content.title` 前 40 字；皆無顯示 `NULL`。
  - 社團名行：有值才顯示單獨一行。

### 決策 #14 — Action Links 與為你推薦標題信號（2026-09-22，probe 實證）
- **症狀**：首頁滾動時，帶有「[追蹤]」、「[加入]」或「為你推薦」的建議動態被判定為 `regular`（reason: `no-match`，relayReads 全為 null）。
- **根因**：
  1. Relay Store 在純滾動瀏覽首頁時因未觸發 mutation，`RelayRecordSourceProxy` 尚未快照（`isReady() === false`），Relay 讀取路徑全數落空。
  2. Comet 架構下，未追蹤作者的「[追蹤]」按鈕、未加入社團的「[加入]」按鈕通常位於 `action_links` 或 `comet_sections.header.story`；而「為你推薦」則直接呈現在 `comet_sections.header.story.title.text`。
- **規則**：
  1. `action_links` 含有 `SUBSCRIBE` / `FOLLOW` / `text: '追蹤'` → `suggested`（reason: `action_links:subscribe`）。
  2. `action_links` 含有 `JOIN_GROUP` / `text: '加入'` → `suggested`（reason: `action_links:join_group`）。
  3. Header 或 Feed Context 含有「為你推薦」/「Suggested for you」且**不含**朋友互動詞彙（如「留言」、「回應」）→ `suggested`（reason: `header:...`）。
### 決策 #15 — React 樹 Context Provider 解包與候選記錄萃取（2026-09-22，probe 實證）
- **症狀**：Comet 架構下，`CometFeedUnitErrorBoundary.react` 傳入的 `payload.feedUnit` 僅有 Relay fragment pointer，真正的貼文資料包在多層 Context Provider（`childrenKeys: ["value", "children"]`）與渲染樹 `lastCmp` 內部。原先代碼讀到第一層 Provider 即停止，導致 `action_links`（追蹤/加入）、`title`（為你推薦）、`actors`（作者姓名與帳號）與貼文網址全數為 `null`，貼文退化為 `regular`（`no-match`）。
- **根因**：Relay 在純滾動瀏覽時不實例化 `RelayRecordSourceProxy`，而 React 元件樹透過多層 Context Provider 傳遞資料，必須遞迴解包（Unpeeling）才能拿到完整的 `story` 物件。
- **解法**：
  1. `classify.js` 與 `metadata.js` 實作 `extractCandidateRecords`，遞迴深度遍歷 `payload`、`payload.children` 與 `lastCmp`，穿透 Context Provider 提取所有含有 `comet_sections`、`actors`、`action_links` 等標記的候選記錄。
  2. `classify.js` 對所有候選記錄進行 `detectActionSignal`、`detectRecommendationHeader` 與 `gatherEvidence` 判定。
  3. `metadata.js` 從候選記錄中萃取作者帳號（`username`）、姓名、貼文完整網址（`permalink_url`）與文字摘要。
  4. `fold.js` 將 `props.lastCmp` 傳入分類器，並增強 `findDiagnosticSignals` 遍歷能力。

### 決策 #16 — Regular posts 成為可折疊的分類（2026-09-22）
- **背景**：決策 #8 原定 `regular` 為 no-match bucket，僅用於統計，不可折疊。但使用者回饋希望普通貼文也能透過切換開關來批量折疊。
- **改動**：
  1. `classify.js` 新增 `CATEGORY.REGULAR = 'regular'` 與 `SETTING_BY_CATEGORY.regular = 'foldRegular'`。
  2. `pickCategory` 改為：當無規則命中且 `evidence.idCount > 0`（具有效 unit 資訊），回傳 `{ category: 'regular', reason: 'no-match' }`；僅有零 id（`no-unit-id`）才保持 `category: null`。
  3. `defaults.js` 新增 `foldRegular: false`（預設展開），並將 `SETTING_KEYS_BY_GROUP.regular` 從 `[]` 改為 `['foldRegular']`。
  4. `bridge.js`、`content.js` 同步補上 `foldRegular: false` 預設值，`MAX_EXPANDED` 擴充至 800。
  5. `options.js` 新增 `groupRegular` 開關，加入 `GROUP_BY_SWITCH` / `SWITCH_BY_GROUP` / `CATEGORY_I18N` 映射，並解除 `updateHighlighting()` 中對 `regular` 的跳過。
  6. `fold.js` 無需修改 — 現有 `isEnabled('regular')` → `false`（toggle OFF）時進入 `reportAllowed` 路徑（無 badge 無切換鈕）；`isEnabled('regular')` → `true`（toggle ON）時進入 `reportBlocked` 路徑（顯示 `[Regular] [+]` 折疊條，點擊展開後顯示 `[Regular] [-]` + 18px Header Bar）。
- **統計行為**：`foldRegular: false` 時，regular 貼文僅計入 `total` 不計 `filtered`（與現有 `reportAllowed` 路徑一致）；`foldRegular: true` 時，計入 `total` + `filtered`。
- **向後相容**：`category: null` 仍用於真正無 unit 資訊的殭屍元素，繼續走 `reportRegular` → `regular` 統計路徑。

### 決策 #17 — 全動態牆 Feed 標籤化與雙向折疊架構（2026-09-22）
- **背景**：先前架構下，toggle == off 的分類（包括預設 off 的 regular 貼文或使用者手動關閉的類別）會直接放行原生 DOM，無 Tag 與 Header Bar。使用者要求動態牆上全部 Feed（除右上角廣告外）皆帶有 Tag 與 Header，並支援雙向 fold/unfold。
- **改動**：
  1. **全面包裝（除右上角廣告外）**：`fold.js` 中的 `FBDietFold` 統一包裝所有進入動態牆的 Feed Units。右上角廣告（`CometAdsSideFeedUnitItem.react`）繼續走 `SideAdHidden` 純隱藏（`display: none`）。
  2. **Toggle 決定初始狀態（Initial State）**：
     - Toggle == ON 的分類（如廣告、推薦、短片）：預設 **Fold（收合）**，顯示 Notice Bar（專屬 Tag + `[+]`），本體 1x1 squash 隱藏。
     - Toggle == OFF 的分類（如一般貼文，或使用者關閉的分類）：預設 **Unfold（展開）**，頂部常駐 18px 細緻 Header Bar（專屬 Tag + `[-]`），本體包在 `fb-diet-expand-body` 中展示。
  3. **雙向即時切換**：`bridge.js` 實作 `isUnitFolded(unitId, defaultFolded)`，使用者點擊任何貼文的 Header（`[-]` 或 `[+]`）皆能即時切換該 unit 的折疊／展開狀態。
  4. **快取上限調升**：`bridge.js` 狀態快取擴充至 800 筆，保障長篇滑動時使用者手動操作不被虛擬滾動遺忘。

---

## 4. 已知誤判案例（症狀 → 根因 → 修正）

| # | 症狀 | 根因（命中規則） | 修正 |
|---|---|---|---|
| 1 | 朋友對某篇文章（自己圖片）留言回應被判 suggested | `story_header:header`（location-free 後備）及／或 `subscribe_status: NOT_SUBSCRIBED` | 決策 #1、#2 |
| 2 | 朋友對公開社團文章留言回應被判 suggested | 同上（社團作者未訂閱 → NOT_SUBSCRIBED 命中） | 決策 #1、#2 |
| 3 | 朋友轉貼含 reel 被判 reels | `unitTypename:ShowcaseFeedUnit`（nested 附件 record 的 typename） | 決策 #3 |
| 4 | 朋友照片被留言回應（「X 最近留言回應。」情境 story）被判 suggested | `story_header:homepage_stream`（與建議標題同一個 keyed record，probe 實證） | 決策 #6（規則全數退役） |

> 注意修正後的副作用：**寧可漏折、不可誤折**。如果發現某些「真的建議貼文」開始漏折，先看 `regular`（category: `regular`, reason: `no-match`）回報的 evidence（見 §5），有資料再精準補規則，不要直接放寬上述條件。

---

## 5. 診斷工具與 runbook（遇到漏判／誤判時）

> **術語**：未命中任何規則的貼文在統計中記為 `regular`（category: `regular`, reason: `no-match`）；`category: null` 代表連 unit 資訊都拿不到（reason: `no-unit-id`），**不代表已確認是一般貼文**，也可能是漏折的建議貼文，這正是 probe 要抓的線索。v1.2.0 前上述值都叫 `unknown`，舊 `fbDietLog` 與舊 probe JSON 仍可能出現該字串。

1. **診斷日誌（自動、持久）**：`chrome.storage.local` 的 `fbDietLog` key，記錄最近 300 筆分類事件（blocked / allowed / regular，含 category、reason、unitTypename、moduleName、evidence、頁面路徑）。
   - Facebook 分頁 Console（選 content script context）：`__fbDietDumpLog()`、`__fbDietClearLog()`。
2. **Feed 診斷按鈕（probe，手動）**：Options 開啟「🔎 顯示 Feed 診斷按鈕」（或 URL 加 `?fb_diet_debug=1`），每個經過 `FBDietFold` 的單元左側外浮現 🔍 按鈕，點擊即複製該單元的精簡 JSON（並在左側浮現類型提示氣泡：類型、群組、作者／社團、判斷、依據；點擊外部可關閉）：`classify` 分類結果（category/reason/evidence）、`enrichment`（作者／社團／內容／媒體／viewer）、`relayReads`（分類器實際讀過的 Relay paths 與回傳值）、觸發的元件模組、單元身份。舊版的完整 payload 快照與 Relay record dump 已移除（見決策 #11）。
   - **漏判診斷**：對沒被摺疊的貼文按 🔍，看 `classify.category` 是 `regular`（`reason: no-match` 代表沒命中規則，或 `foldRegular` 關閉）還是 `null`（`reason: no-unit-id`）；把 JSON 貼給對照 §3 補規則。
   - **誤判診斷**：對被誤折的貼文展開後按 🔍，看 `reason` 對回 §3 的哪條規則。
3. **Options Debug 卡（報告判讀）**：Options 頁面底部的 DEBUG 卡可貼上 probe 複製的 JSON，按「判斷」即顯示當時分類結果，並用**目前版本規則**對 `payload` 重跑一次分類做對比。已知限制：probe 快照只含第一筆 record，`^` / `^^` 連結路徑在重跑時讀不到值（結果可能退化為 `no-match`），此時以當時結果為準。
4. **即時 console**：URL 加 `?fb_diet_debug=1`，看 `[FB Diet][MAIN]` / `[FB Diet][Classify]` 輸出。
5. **單元測試**：`npm test`；新規則務必補 `tests/classify.test.js` 迴歸測試。

### 新增規則的安全流程
1. 從 `no-match` 的 evidence（或 probe JSON）找出候選 Relay path / typename。
2. 確認該證據**不會**命中正常朋友貼文（在多個情境下驗證）。
3. 加到 `pickCategory` 的優先序中（廣告 > 社團 > 建議 > reels）。
4. 補測試（正向 + 至少一個「朋友貼文不得命中」的反向測試）。
5. 在本文件 §3 追加一條決策記錄。
