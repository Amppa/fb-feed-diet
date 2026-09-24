# F.B. Sponsored/Ad Post Blocker — 逆向工程與混淆對抗實戰報告

本文檔針對開源專案 **F.B. Sponsored/Ad Post Blocker**（Firefox/Chromium 雙平台擴充套件）進行深度程式碼追蹤（Trace Code）與實戰教訓拆解。

該專案是目前純 DOM 領域對抗 Facebook 前端反爬與字元混淆技術最深入、實戰教訓最詳盡的代表作。

---

## 1. 架構全景概覽 (Architecture Overview)

- **目標平台**：Firefox (MV3) 與 Chromium 系列（Chrome, Edge, Brave, Opera）。
- **核心檔案**：
  - `content.js`（核心過濾邏輯，高達 2,250 行精煉代碼）
  - `DESKTOP-AD-LABELS.md`（作者長達數月對抗桌面廣告失敗與突破的權威紀錄）
- **核心理念**：
  面對 Facebook 極度動態、高頻變更的混淆手法，**不依賴靜態 Class 名稱，完全基於視覺佈局幾何（Flexbox `order`）、向量引用（SVG `<use>`）以及可訪問性語意樹（ARIA tree）**。

---

## 2. 核心演算法：Flexbox Order 亂序重組與假字元分區 ⚡

### Facebook 的字元混淆機制
Facebook 將贊助標記「Sponsored」進行了多重反爬混淆：
1. **單字元碎片化**：每個字母被包進獨立的 `<span>`。
2. **不可見 Unicode 污染**：每個字元前後插入零寬度字元（Zero-width joiners / Combining marks），直接讀取 `.textContent` 永遠無法拼出單詞。
3. **假字符混入（Decoy characters）**：在標籤中插入隨機無關字符干擾比對。
4. **CSS 亂序（Flexbox `order`）**：在 DOM 樹中的節點順序完全打亂，僅靠 CSS `order` 屬性在使用者螢幕上呈現正確視覺排列。

### 破解第一步：預檢防禦，避免 Main Thread 卡死 (`isCharacterSplit`)
直接對頁面節點調用 `getComputedStyle()` 會強制觸發瀏覽器的 Style Recalculation 與 Layout Reflow，若對動態牆數千個節點執行會造成嚴重的掉幀與畫面凍結。

該專案採用極其嚴密的 **O(1) 純結構預檢**：
```javascript
const MIN_SCRAMBLED_LABEL_CHILDREN = 4;
const MAX_SCRAMBLED_LABEL_CHILDREN = 120;

function isCharacterSplit(el) {
  const children = el.children;
  if (children.length < MIN_SCRAMBLED_LABEL_CHILDREN || children.length > MAX_SCRAMBLED_LABEL_CHILDREN) return false;
  for (const child of children) {
    // 必須全為無子節點的 SPAN，且去除不可見字元後長度不超過 1
    if (child.tagName !== "SPAN" || child.children.length !== 0) return false;
    if (child.textContent.replace(INVISIBLE_CHARS_RE, "").length > 1) return false;
  }
  return true; // 99.9% 的普通 DOM 節點在此被廉價剔除
}
```

### 破解第二步：按視覺 Order 重新排序 (`collectOrderedLeaves`)
僅在通過預檢後，對該節點及其子元素收集 Computed `order` 並排序：
```javascript
function collectOrderedLeaves(node, depth = 0) {
  // ... 略過 text node 與深度邊界檢查 (MAX_LABEL_DEPTH = 4)
  const withOrder = Array.from(node.childNodes).map((child, index) => {
    let order = index;
    let hidden = false;
    if (child.nodeType === Node.ELEMENT_NODE) {
      const computed = getComputedStyle(child);
      const parsed = parseInt(computed.order, 10);
      if (!Number.isNaN(parsed)) order = parsed;
      hidden = computed.display === "none" || computed.visibility === "hidden";
    }
    return { child, order, hidden };
  });

  withOrder.sort((a, b) => a.order - b.order); // 依視覺順序排列
  // 濾除隱藏節點，收集 classCount 與乾淨字元
}
```

### 破解第三步：假字元分區容錯 (`labelVariants`)
Facebook 透過 Class 數量來區分真假字符，但該信號的「方向是浮動的」（有時真字符 Class 較多，有時假字符 Class 較多）。

作者採取「不預測方向，同時組合三種可能分區」的策略：
```javascript
function labelVariants(el) {
  const leaves = collectOrderedLeaves(el);
  const assemble = (keep) =>
    leaves
      .filter((leaf) => leaf.classCount === null || keep(leaf.classCount))
      .map((leaf) => leaf.text)
      .join("")
      .replace(INVISIBLE_CHARS_RE, "")
      .trim();

  return [
    assemble(() => true),                                  // 分區 1: 全數保留
    assemble((n) => n > HONEYPOT_LEAF_CLASS_COUNT),         // 分區 2: 僅保留高 class 數節點
    assemble((n) => n <= HONEYPOT_LEAF_CLASS_COUNT),        // 分區 3: 僅保留低 class 數節點
  ];
}
```
比對時，三種分區字串只要任一符合「Sponsored / Ad」即判定命中。

---

## 3. 致命踩坑與失敗教訓 (Author's Critical Lessons)

根據作者實戰紀錄（`DESKTOP-AD-LABELS.md`），有數個極為危險的過濾陷阱：

### 陷阱 1：`data-ad-rendering-role` 絕對不可作為廣告唯一判斷
許多開發者發現廣告卡片帶有 `data-ad-rendering-role="profile_name"` 或 `cta` 屬性，誤以為找到了官方廣告旗標。

* **實測真相**：Facebook 內部普通貼文（特別是追蹤的公開粉專、二手拍賣社團貼文）也使用同一套 Comet Story 模板渲染，**普通貼文同樣帶有這些 ad-roles**。以此為判斷條件會直接殺死整面動態牆（全域誤殺）。

### 陷阱 2：巢狀引用的 Follow 按鈕誤殺 (`isAuthorLevelLabel`)
- **場景**：社團內好友轉發了外來未追蹤專頁的貼文。轉發內容內部包含該專頁的「Follow / 追蹤」按鈕。
- **後果**：若只檢測貼文內是否存在 Follow 按鈕，好友在社團發布的正常貼文會整篇被誤隱藏。
- **解法**：嚴格限定按鈕必須出現在貼文卡片的**第一個 Heading 標題區塊（Author Header）**。深層嵌入的引用內容一律略過。

### 陷阱 3：短字串比對的邊界陷阱
Facebook 逐漸將「Sponsored」簡化為「Ad」。若使用子字串搜尋（Substring match），普通用戶姓名或內文含有 "ad"（例如 "Brad"、"Late Ad"、"Address"）將全數遭誤殺。短標籤必須強制精確匹配或單詞邊界隔離。

### 陷阱 4：自身永久連結否決權 (Permalink Veto)
真實貼文一定會附帶指向自身的永久連結（如 `/posts/`, `/commerce/listing/`, `/videos/`）；純廣告通常沒有自身貼文路徑（或是外部推廣連結）。但特別注意：**`/stories/<id>/` 不能作為非廣告白名單**，因為特定品牌贊助故事也使用該路徑。

---

## 4. 與 FB Diet 的深度技術對比

| 比較維度 | F.B. Sponsored Blocker | FB Diet (本專案) |
| :--- | :--- | :--- |
| **運作空間** | 純 ISOLATED World | **MAIN World 模組攔截 + Relay 資料層** |
| **獲取信號** | 逆向視覺 Flex `order` + SVG `<use>` + 假字符分區 | 直接讀取 Relay Record Store 記憶體 (`ad_id`, `CAN_SUBSCRIBE`) |
| **DOM 混淆抗性** | **極致**（已攻克 Flex order 與符號混淆） | **超越 DOM**（直接在資料層定勝負，完全無視 DOM 混淆） |
| **CPU 渲染開銷** | 需依賴 `requestAnimationFrame` 與批次合併降低開銷 | **原生零開銷**（隨 React 組件生命週期執行，無輪詢無 style 計算） |
| **React 延遲加載容錯** | 需維護 `pendingLabels` 隊列（50ms~8s 輪詢重試） | Relay Store 與 Props 解包天然涵蓋異步資料更新 |

---

## 5. FB Diet 可吸收的精華技巧

1. **`isAuthorLevelLabel` 的層級防線**：
   在 FB Diet 的 Fallback 文字檢查層中，若要檢測 Follow / Join 按鈕，必須確保該按鈕位於首層 Heading，杜絕轉發貼文誤殺。
2. **文字標籤分區預檢 (`isCharacterSplit`)**：
   若 FB Diet 未來需要補足純 DOM Fallback 能力，這套預檢機制能保證不會因 `getComputedStyle` 拖垮頁面 FPS。
3. **銘記 `data-ad-rendering-role` 誤殺警告**：
   絕不將任何 `data-ad-*` 屬性當作單一充要條件，始終以 Relay Store 與確定性字元/鏈接作為判斷標準。
