# BlockZilla (v2.6.0) — 逆向工程與架構深度剖析

本文檔針對商業級廣告阻擋擴充套件 **BlockZilla** (`v2.6.0`，官方網站: `https://blockzilla.app`) 的 Facebook 專屬過濾模組進行深度代碼追蹤（Trace Code）、演算法還原與架構分析。

---

## 1. 架構全景概覽 (Architecture Overview)

BlockZilla 採用 **Manifest V3 + 跨站專責腳本（Site-Specific Modules）** 架構：
- **網絡層**：透過 `declarativeNetRequest` 規則庫（`data/generated/rules.json`）在請求發起前攔截廣告與分析追蹤網址。
- **客戶端層**：依網域劃分模組（涵蓋 Amazon, Facebook, Google, LinkedIn, Reddit, Twitter 等 17 個站點）。
- **Facebook 專責目錄結構**：
  ```text
  websites/facebook.com/
  ├── css/
  └── js/
      ├── common.js                     # 多語系字典（贊助、推薦關鍵字）
      ├── sponsored_posts.js            # 主動態牆動態贊助貼文攔截（核心）
      ├── suggested-for-you.js          # 為你推薦貼文與好友推薦
      ├── marketplace-ads.js            # Marketplace 市集贊助商品專屬過濾
      ├── sponsored-ads-right-panel.js  # 桌面版右側固定欄廣告過濾
      └── referral-id.js                # 網址追蹤參數與 referral 標籤清洗
  ```

---

## 2. 核心演算法：SVG 向量圖形 XPath 逆向拼裝術 ⚡

這是 BlockZilla 面對 Facebook 現代 DOM 混淆時**最核心且具工程代表性**的演算法。

### 背景痛點
Facebook 在 Chromium 瀏覽器上不再輸出文字「Sponsored」，而是將標籤繪製為 SVG 向量圖形：
```html
<svg class="..."><use xlink:href="#SvgT31"></use></svg>
```
頁面文字中完全搜尋不到字串，一般的 `textContent.includes('Sponsored')` 徹底失效。

### BlockZilla 的破解流程

```mermaid
graph TD
    A[文檔加載/滾動 Mutation] --> B[initSvgTextElementMap<br/>掃描所有 id^='Svg' 或 id^='gid' 節點]
    B --> C[建立符號字典: map['#SvgT31'] = 's']
    C --> D[XPath 查詢: //*local-name()='use']
    D --> E[遍歷 parentSVG.childNodes<br/>拼裝字符 content += map[use.href]]
    E --> F{content === keyword?}
    F -->|命中| G[findParentSVGPostElement 向上回溯]
    G --> H[標記 isSponsored 並調用 checkAndHideAd]
    F -->|未命中| I[打上 bzParsed 標記避免重複掃描]
```

#### Step 1: 符號字典初始化 (`initSvgTextElementMap_V3`)
Facebook 會將單獨的字元或短語存放在頁面的 `<symbol id="Svg...">` 或 `<svg id="gid...">` 中供螢幕報讀。BlockZilla 預先建立 ID 到文字的映照表：
```javascript
function initSvgTextElementMap_V3() {
    const map = [];
    const elements = document.querySelectorAll('[id^="Svg"]');
    for (let i = 0; i < elements.length; ++i) {
        const el = elements[i];
        let textContent = '';
        if (el.nodeName === 'svg') {
            const sub = el.querySelector('use');
            if (sub && sub.hasAttribute('xlink:href')) {
                const textEl = document.querySelector(sub.getAttribute('xlink:href'));
                if (textEl) textContent = textEl.textContent.trim().toLowerCase();
            }
        } else {
            textContent = el.textContent.trim().toLowerCase();
        }
        if (textContent) map['#' + el.id] = textContent;
    }
    return map;
}
```

#### Step 2: XPath 快速檢索引用節點 (`checkSVGs_V3`)
利用瀏覽器原生高效能的 `document.evaluate` 執行 XPath 運算，直接撈出所有使用該前綴的 `<use>` 節點：
```javascript
const xpathExpression = '//*[local-name()="use" and starts-with(@xlink:href, "#Svg")]';
const result = document.evaluate(
    xpathExpression,
    document,
    prefix => ({ 'xlink': 'http://www.w3.org/1999/xlink' }[prefix] || null),
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null
);
```

#### Step 3: 拼裝文字還原與判定
將同一個母 SVG 標籤內的多個 `<use>` 標籤指向的字符連續拼接，還原真實字串：
```javascript
let content = '';
for (let j = 0; j < parentSVG.childNodes.length; ++j) {
    const useElement = parentSVG.childNodes[j];
    const gid = useElement.href.baseVal;
    content += svgTextElementMap[gid];
}
if (keyword === content) {
    const parent = findParentSVGPostElement(parentSVG);
    if (parent) {
        parent.isSponsored = true;
        checkAndHideAd(parent, parentSVG, true);
    }
}
parentSVG.setAttribute('bzParsed', '');
```

---

## 3. 防禦性設計：連續誤判緊急熔斷機制 (`isEmergencyStopped`)

許多純 DOM 攔截套件最致命的問題是：一旦 Facebook 改版，標籤解析失常，導致將正常動態「整排殺光」。

BlockZilla 設計了極具工程智慧的**計數熔斷防護**：
```javascript
function isExeededEmergencyCounter(element) {
    if (element.isSponsored === true) {
        var parentPostElement = findParentPostElement(element);
        // 如果被判定為廣告的卡片，其緊鄰的前一個兄弟節點也是剛被隱藏的廣告
        if (parentPostElement.previousSibling == previousPostElement) {
            if (++consequentlyCounter === 3) {
                isEmergencyStopped = true; // 連續 3 篇貼文都被判定為廣告，強制熔斷！
                return true;
            }
        } else {
            consequentlyCounter = 0;
        }
        previousPostElement = parentPostElement;
    }
    return false;
}
```
- **核心哲學**：在正常 Facebook 首頁動態牆中，官方算法絕不會連續出現 3 篇純贊助廣告。如果連續 3 篇貼文都被命中，代表特徵匹配邏輯已經發生**全域性誤殺（Cascading False Positive）**，此時立即終止（Fail-safe），寧可暫時漏擋，也絕不破壞使用者正常的閱讀體驗。

---

## 4. 混淆對抗演進史 (Evolutionary Heuristics V1 ~ V6)

在 `sponsored_posts.js` 中保留了 BlockZilla 多年來對抗 Facebook 樣式混淆的完整演化軌跡：

| 版本 | 偵測目標 | 核心原理 |
| :--- | :--- | :--- |
| **V1** | 純文字匹配 | `getElementsByText(pageletElement, keyword)` 直接比對字串 |
| **V2** | Flexbox Order 混淆 | 遍歷 `*[style*="order"]`，過濾 `position != 'absolute'` 並按 computed `order` 還原字串 |
| **V3** | 單字元碎裂 span | 篩選 `textContent.length === 1` 且非 absolute 的所有符號 |
| **V4** | SVG Use 符號映射 | 讀取 `<svg use xlink:href>` 並查表還原 |
| **V5** | Canvas 元素寬度特徵 | 比對 `a[role="link"] canvas` 與母容器 `parentCalculatedWidth` 寬度比例 |
| **V6** | 字符子集容錯匹配 | `findLettersInText` 檢查關鍵字字符在候選字串中的分散包含率（`isMatch`） |

---

## 5. 多區域分工實作 (Specialized Partitions)

### 1. Marketplace 市集廣告 (`marketplace-ads.js`)
市集頁面不採用動態牆的 FeedUnit 結構，BlockZilla 採用專用特徵鏈：
- `hideElementTitle('a[href*="/ads/"]', keyword)`：直擊帶有廣告連結特徵的商品卡片。
- `hideElementBlockOnCategoryPage('object[type="nested/pressable"] span', keyword)`：鎖定市集分類頁面的嵌套按鈕。
- 向上回溯演算法 `findParentElementByHref(element, 'a')`：以階層方式逐級回溯至最外層商品外框（`parent.parentNode.parentNode.parentNode`）。

### 2. 桌面版右側固定欄 (`sponsored-ads-right-panel.js`)
鎖定 Facebook 側邊欄（`role="complementary"` 或右側導航條）：
- 針對側邊欄中 `a[href*="l.facebook.com/l.php"]` 或帶有 Sponsored aria-label 的區塊，直接將整個廣告掛件隱藏。

---

## 6. 與 FB Diet 的深度技術對比

| 比較維度 | BlockZilla (v2.6.0) | FB Diet (本專案) |
| :--- | :--- | :--- |
| **截獲層級** | **純 DOM 渲染後處理** (Post-Render DOM) | **MAIN World 模組攔截 + Relay 資料層** (Pre-Render Lifecycle) |
| **判定依據** | XPath 查詢 SVG `<use>` + 符號拼裝字典 | 直接讀取 Relay Record Store (`ad_id`, `CAN_SUBSCRIBE`) |
| **DOM 混淆抗性** | **中高**（依賴 XPath 與 SVG ID 命名規律，FB 換前綴需發版修復） | **極高**（直接存取 JavaScript 記憶體結構，完全無視 DOM 混淆） |
| **CPU 性能消耗** | 較高（滾動時需執行 XPath、遍歷 DOM 樹、解析計算樣式） | **極低**（React 生命週期 Hook，隨組件渲染即時判斷，無額外 DOM 遍歷） |
| **容錯防護機制** | **連續 3 篇誤殺緊急熔斷 (`isEmergencyStopped`)** | 白名單範圍限制 (`restrictFoldScope`) + 降級純摺疊渲染 |
| **隱藏視覺體驗** | `display: none` 直接消失 或 附加 Hide 按鈕 | **平滑折疊佔位列 (Fold Bar / Title Mode)**，避免虛擬滾動斷層 |

---

## 7. FB Diet 可借鑑的精華與改進建議

1. **DOM Fallback 武器庫補充**：
   - 當 FB Diet 的 Relay Store 處於冷啟動、或 Facebook 局部改版導致 GraphQL Props 未即時解析時，BlockZilla 的 **「XPath 抓取 SVG Symbol 拼裝字元」** 邏輯，是極佳的 DOM Fallback 備援方案。
2. **導入連鎖誤判熔斷保護 (Circuit Breaker)**：
   - 可在 FB Diet 的分類層加入類似的健康度檢測：若短時間內連續高頻命中未知名稱的卡片，自動進入安全保護狀態，防止例外災情。
3. **市集與側邊欄廣告擴展**：
   - BlockZilla 針對 `a[href*="/ads/"]` 與市集巢狀卡片的回溯邏輯非常簡潔，未來若 FB Diet 擴展非主 Feed 區域時，可直接採納其經驗。
