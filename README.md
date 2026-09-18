# FB Diet - Feed Declutter & Ads Diet for Facebook™

A modern, lightweight Chrome Extension (Manifest V3) designed to put your Facebook feed on a clean, healthy diet.

Instead of abruptly wiping elements or breaking the feed, **FB Diet** neatly folds sponsored posts, suggestions, and ads into elegant inline placeholders with seamless **one-click expand and restore**.

---

## ✨ Features

- **Master Switch**: One-click global toggle to pause or resume diet filtering anytime.
- **🛡️ Remove Sponsored Posts**: Folds sponsored posts and sidebar ads across your feed.
- **💡 Remove Suggested for You**: Folds algorithmic noise like "Suggested for you", recommended groups, and follow prompts.
- **🛒 Remove Market Ads**: Folds sponsored listings and promo cards in Facebook Marketplace.
- **🔍 Remove Searching Ads**: Folds ad units from search results.
- **Interactive Placeholders**:
  - Folded content is replaced with a clean placeholder matching Facebook's native Light and Dark theme styles.
  - Users can click **"Expand"** to view the full original post without refreshing, and re-fold it as needed.
- **Live Diet Dashboard & Counters**:
  - Real-time stats showing how many ads and recommendations have been folded.
  - Breakdown counters for Sponsored, Suggested, Marketplace, and Search ads.
  - One-click **Reset** button to clear statistics.
- **Ultra-Lightweight & Safe**:
  - Built with pure Vanilla JS and CSS (zero heavy dependencies, < 50KB).
  - Compliant with Chrome Web Store standards (no CSP header modifications or risky private hooks).
  - Throttled storage sync (3s buffer) ensuring smooth 60fps feed scrolling.

---

## 🚀 Installation Guide

1. Clone or download this repository.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** (載入未封裝項目).
5. Select the `fb-diet` directory.
6. Open [Facebook](https://www.facebook.com) to enjoy a decluttered feed!

---

## 🔁 Development Workflow (avoid "Extension context invalidated")

Content scripts are cached per tab, so after editing any file you must:

1. Go to `chrome://extensions/` and click **🔄 Reload** on **FB Diet**.
2. Reload every open Facebook tab (or close them and open a new one).

If you skip step 2, the already-open tab keeps running the **old** script. Because the extension
was reloaded, that orphaned script loses its `chrome.*` APIs, and any pending statistics flush
throws `TypeError: Cannot read properties of undefined (reading 'local')`.

**FB Diet now detects this situation and shuts itself down silently** (`shutdown()` in
`src/content/content.js`): the `MutationObserver` is disconnected, pending timers are cleared and
no further storage access is attempted — so an orphaned tab stays quiet until you refresh it.
`chrome://extensions/` → **Errors** and the page console should stay completely clean.

---

## 📂 Project Structure

```text
fb-diet/
├── manifest.json              # Chrome Extension MV3 configuration
├── icons/                     # Extension icons (16, 32, 48, 128)
├── src/
│   ├── background/
│   │   └── background.js      # Service worker for initialization and message routing
│   ├── content/
│   │   ├── detector.js        # Multilingual anti-obfuscation rules and text parsing
│   │   ├── content.js         # MutationObserver, fold/expand logic & throttled counter
│   │   └── content.css        # Adaptive inline placeholder and animation styles
│   └── popup/
│       ├── popup.html         # Dark glassmorphic dashboard layout
│       ├── popup.css          # Modern dark styling, tabular counters, and smooth switches
│       └── popup.js           # Real-time state syncing and counter controls
├── package.json               # Metadata and scripts
└── README.md                  # Project documentation
```

---

## 🛠️ Tech Stack & Implementation Details

- **Platform**: Chrome Manifest V3
- **Design System**: Modern Dark UI inspired by `frosted-feed` with custom gradient badges and tabular counters.
- **DOM Handling**: Non-destructive class toggling preserving React component tree integrity.

---

## 📄 License

MIT License.
