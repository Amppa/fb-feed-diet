# Privacy Policy for FB Feed Diet

*Last updated: October 9, 2026*

[English](#english) | [繁體中文](#繁體中文)

---

<a name="english"></a>
## English

### 1. Overview
**FB Feed Diet** ("the extension") is an open-source browser extension designed to provide a cleaner, distraction-free reading experience on Facebook by folding sponsored posts, recommendations, and reels into sleek title bars.

We strongly value your privacy. FB Feed Diet is built on a **local-first, zero-data-collection** philosophy. The extension operates entirely within your browser on your local device.

### 2. Information Collection and Use
* **No Personal Data Collected**: The extension does NOT collect, store, transmit, or sell any personal information, including but not limited to your name, email address, IP address, Facebook credentials, or account details.
* **No Browsing History Collected**: The extension does NOT record, monitor, or transmit your browsing history, clicks, search queries, or the content of the posts you view.
* **No Analytics or Telemetry**: The extension contains no analytics services, advertising libraries, tracking pixels, or telemetry scripts (such as Google Analytics or Mixpanel).

### 3. Permissions Justification
FB Feed Diet declares only the minimum necessary permissions required for its functionality:

* **Host Permission (`*://*.facebook.com/*`)**:
  * *Purpose*: Used exclusively to run content scripts on Facebook feed pages to detect, classify, and visually fold sponsored posts, recommendations, and reels into title bars. All DOM scanning and data processing occur 100% locally in your browser memory and never leave your machine.
* **`storage`**:
  * *Purpose*: Used to save your personal preferences (e.g., categories to fold, title bar height, theme mode) and daily local filtering statistics using Chrome's local storage API (`chrome.storage.local`). This data is stored strictly on your local device.
* **`scripting`**:
  * *Purpose*: Used to dynamically apply updated configuration settings and stylesheets to currently active Facebook tabs without requiring a manual page refresh.

### 4. Third-Party Servers
The extension does not operate any backend servers, databases, or cloud endpoints. It makes zero outgoing network requests to third-party services or remote servers.

### 5. Security & Transparency
The entire source code of FB Feed Diet is public and open-source under the MIT License. Anyone can audit and verify the code at our GitHub repository:
https://github.com/Amppa/fb-feed-diet

### 6. Changes to This Privacy Policy
We may update this Privacy Policy from time to time. Any changes will be posted in this document and tracked via our public Git history.

### 7. Contact & Support
If you have any questions or feedback regarding this Privacy Policy, please open an issue on our GitHub repository:
https://github.com/Amppa/fb-feed-diet/issues

---

<a name="繁體中文"></a>
## 繁體中文

### 1. 概述
**FB Feed Diet**（以下簡稱「本擴充功能」）是一款開源瀏覽器套件，旨在透過將 Facebook 動態消息中的贊助廣告、演算法推薦與 Reels 短影音折疊為標題列，提供乾淨無干擾的閱讀體驗。

我們極度重視您的隱私權。本擴充功能完全基於 **「本機處理、零資料收集」** 的架構運作，所有邏輯皆在您的本機瀏覽器內執行。

### 2. 資料收集與使用聲明
* **絕不收集個人資料**：本擴充功能不會收集、儲存、傳輸或販售任何個人資訊（包括姓名、電子郵件、IP 位址、Facebook 登入憑證或帳號資料）。
* **絕不記錄瀏覽行為**：本擴充功能不會記錄、監控或傳輸您的瀏覽紀錄、點擊行為、搜尋關鍵字或您瀏覽的貼文內容。
* **無任何分析或追蹤程式碼**：本擴充功能不包含任何第三方分析工具、廣告 SDK、追蹤像素或遙測腳本（如 Google Analytics 等）。

### 3. 權限使用說明
本擴充功能僅宣告達成功能所需之最小必要權限：

* **主機權限 (`*://*.facebook.com/*`)**：
  * *用途*：僅用於在 Facebook 頁面上執行過濾與分類腳本，將廣告與推薦項目折疊為標題列。所有的頁面分析均 100% 在您的本機記憶體中完成，絕不會將任何內容傳出您的電腦。
* **`storage` 權限**：
  * *用途*：使用瀏覽器本機儲存空間 (`chrome.storage.local`) 保存您的偏好設定（如折疊類別、標題列高度、深淺色主題）以及每日過濾計數統計，資料僅保留在本機端。
* **`scripting` 權限**：
  * *用途*：當您在選項頁調整設定時，將新設定即時同步至已開啟的 Facebook 分頁，免手動重新整理網頁。

### 4. 第三方伺服器與外部連線
本擴充功能沒有設立任何後端伺服器或資料庫，運作過程中亦不會發出任何對外連線至第三方服務。

### 5. 安全性與開源透明
本擴充功能遵循 MIT 授權條款完全開源，任何人皆可在 GitHub 儲存庫查驗原始碼：
https://github.com/Amppa/fb-feed-diet

### 6. 聯絡與支援
若您對本隱私權政策有任何疑問，歡迎至本專案 GitHub Issues 提出：
https://github.com/Amppa/fb-feed-diet/issues
