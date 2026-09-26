# FB Feed Diet - Clean Feed & Ads Declutter for Facebook™

A modern, lightweight Chrome Extension designed to put your Facebook feed on a clean, healthy diet.

Instead of abruptly wiping elements or breaking your feed, **FB Feed Diet** neatly folds sponsored posts, suggestions, and ads into elegant inline placeholders with seamless **one-click expand and restore**.

---

## ✨ Features

- **Master Switch**: One-click global toggle to pause or resume diet filtering anytime.
- **💸 Fold Ads**: Folds sponsored posts, Marketplace listings, and search ads.
- **🤵 Fold Facebook Suggestions**: Folds recommended posts from people you don't follow ("Suggested for you").
- **🎬 Fold Reels & Stories**: Keeps your feed focused by folding Reels and Stories carousels.
- **👥 Fold Other Recommendations**: Folds group recommendations ("Groups you should join").
- **One-Click Expand & Restore**:
  - Folded items are replaced with a sleek, non-intrusive placeholder bar matching Facebook's Light and Dark themes.
  - Curious about a folded post? Click **"Expand"** to view the original content instantly, and re-fold it whenever you want.
- **Live Diet Dashboard & Counters**:
  - Real-time statistics showing how many distractions have been folded.
  - Category breakdown and a one-click reset in the Options page.
- **Privacy-First & Ultra-Lightweight**:
  - Zero external tracking, zero third-party dependencies, and zero data leaves your browser.
  - Highly optimized (< 50KB) to ensure smooth 60fps scrolling.

---

## 🚀 Installation Guide

1. Download or clone this repository to your computer.
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** (載入未封裝項目).
5. Select the `fb-diet` folder.
6. Open [Facebook](https://www.facebook.com) and enjoy a clean, distraction-free feed!

### Firefox (128 or newer)

The same package also runs on Firefox — the MAIN-world content scripts require Firefox 128+ (`browser_specific_settings.gecko.strict_min_version`).

1. Build the package with `npm run package` (or use the repository folder directly).
2. Open Firefox and navigate to `about:debugging#/setup/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** (暫時性載入附加元件) and select `manifest.json` from the zip (or the repository).
4. Open [Facebook](https://www.facebook.com) and enjoy a clean feed!

> Temporary add-ons are unloaded when Firefox restarts — repeat step 3 to reload.

---

## 💡 How to Use

- **Quick Toggle**: Click the **FB Feed Diet** icon in your Chrome toolbar to turn filtering ON or OFF instantly.
- **Detailed Settings**: Click **"Options"** in the popup to customize which types of content to fold (e.g. keep Reels while folding Sponsored ads).
- **Expand a Post**: When a post is folded, click **"Expand"** on the placeholder bar to view it without reloading the page.

---

## 🔒 Privacy & Permissions

- **Storage (`chrome.storage`)**: Used strictly to save your filter preferences and local counter statistics on your device.
- **Host Permissions (`*://*.facebook.com/*`)**: Required solely to fold ads and render placeholders on Facebook pages.
- **No Data Collection**: FB Diet does not collect, track, or transmit any personal data, browsing history, or feed content.

---

## 👨‍💻 For Developers

Looking for internal architecture details, MAIN world proxy mechanisms, debugging consoles, or unit tests?

- **[Development Guide & Architecture (DEVELOPMENT.md)](DEVELOPMENT.md)**: Deep dive into the Dual-World architecture, project conventions and guardrails, module responsibilities, in-browser diagnostic consoles, and test suites.
- **[Engineering Contract & Rules (AGENTS.md)](AGENTS.md)**: Project-agnostic engineering discipline for AI agents — Git workflow, commit granularity, verification discipline, and autonomy boundaries.
- **[Classification Strategy & Decision Log (STRATEGY.md)](STRATEGY.md)**: Authoritative documentation of Relay field paths and feed classification rules.

---

## 📄 License

MIT License.
