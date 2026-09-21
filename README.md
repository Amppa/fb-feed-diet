# FB Diet - Feed Declutter & Ads Diet for Facebook™

A modern, lightweight Chrome Extension designed to put your Facebook feed on a clean, healthy diet.

Instead of abruptly wiping elements or breaking your feed, **FB Diet** neatly folds sponsored posts, suggestions, and ads into elegant inline placeholders with seamless **one-click expand and restore**.

---

## ✨ Features

- **Master Switch**: One-click global toggle to pause or resume diet filtering anytime.
- **🛡️ Fold Sponsored Posts**: Folds sponsored posts and promotional ads across your feed.
- **💡 Fold Suggested Content**: Folds algorithmic suggestions ("Suggested for you", recommended follow prompts).
- **👥 Fold Suggested Groups**: Separately folds group recommendations ("Groups you should join").
- **🎬 Fold Reels & Stories**: Keeps your feed focused by folding Reels and Stories carousels.
- **🛒 Fold Marketplace Ads**: Folds sponsored listings and promo cards in Facebook Marketplace.
- **🔍 Fold Search Ads**: Folds advertising units in Facebook search results.
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

---

## 💡 How to Use

- **Quick Toggle**: Click the **FB Diet** icon in your Chrome toolbar to turn filtering ON or OFF instantly.
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

- **[Development Guide & Architecture (DEVELOPMENT.md)](DEVELOPMENT.md)**: Deep dive into the Dual-World architecture, module responsibilities, in-browser diagnostic consoles, and test suites.
- **[Engineering Contract & Rules (AGENTS.md)](AGENTS.md)**: Engineering discipline, MV3 coding guidelines, Git workflow, and AI assistant behavior specifications.
- **[Classification Strategy & Decision Log (STRATEGY.md)](STRATEGY.md)**: Authoritative documentation of Relay field paths and feed classification rules.

---

## 📄 License

MIT License.
