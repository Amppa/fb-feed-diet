# FB Feed Diet - Clean Feed & Ads Declutter for Facebook

[繁體中文](README.zh-TW.md) | [English](README.md)

[![GitHub release](https://img.shields.io/github/v/release/Amppa/fb-feed-diet)](https://github.com/Amppa/fb-feed-diet/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

FB Feed Diet is a browser extension for Facebook designed to hide sponsored posts, recommended content, Reels, and ads from your news feed, decluttering your reading experience.

Folded posts are replaced with a sleek **title bar** that can be expanded anytime with a single click, without abruptly removing blocks or breaking page layout. You can also customize folding rules and display preferences to suit your reading habits.

## Preview

<table>
  <thead>
    <tr>
      <th align="center">Before Filtering</th>
      <th align="center">After Filtering (Ads & Suggestions)</th>
    </tr>
  </thead>
  <tbody>
    <tr valign="top">
      <td align="center" valign="top"><img src="screenshots/before.png" width="300" alt="Before Filtering"></td>
      <td align="center" valign="top"><img src="screenshots/after-default-2.png" width="300" alt="After Filtering"></td>
    </tr>
  </tbody>
</table>

## Features

### Standard Mode (Default)

* **Block Ads (Sponsored Content)**: Folds sponsored posts, Marketplace recommendations, and search ads.
* **Block Suggestions (Recommended Posts)**: Folds algorithmic recommendations like "Suggested for you".
* **Hide Short Videos (Reels & Stories)**: Optional toggles to fold Reels and Stories carousels.
* **Live Stats**: Counts daily blocked ads, suggestions, and video items.
* **Hover Preview**: Hover your cursor over the title bar to preview full post content without clicking "See more".
* **Expand & Collapse Anytime**: Replaces folded content with title bars; click anywhere on the bar to reveal the post.

<table>
  <thead>
    <tr>
      <th align="center">Regular Post</th>
      <th align="center">Hover Tooltip Preview</th>
      <th align="center">Folded State</th>
    </tr>
  </thead>
  <tbody>
    <tr valign="top">
      <td align="center" valign="top"><img src="screenshots/feed-expand.png" width="300" alt="Regular Post"></td>
      <td align="center" valign="top"><img src="screenshots/feed-titlebar-snipet.png" width="300" alt="Hover Tooltip Preview"></td>
      <td align="center" valign="top"><img src="screenshots/feed-fold.png" width="300" alt="Folded State"></td>
    </tr>
  </tbody>
</table>

### Forum / Index Mode

* **Custom Folding Rules**: Ideal if you prefer skimming headlines and clicking to expand only what interests you.
* **Appearance Customization**: Customize title bar height (18px or 26px, default 18px).

<img src="screenshots/after-minimize-mode2.png" height="400" alt="Minimized Mode">


## Installation

### Google Chrome

#### Method 1: Chrome Web Store

Coming soon.

#### Method 2: Download Release Package

1. Go to the [Releases](https://github.com/Amppa/fb-feed-diet/releases) page and download the latest Chrome ZIP package.
2. Extract the ZIP file to a local folder and keep the folder intact for your browser to load.
3. Open Google Chrome and navigate to `chrome://extensions/`.
4. Enable **Developer mode** in the top-right corner.
5. Click **Load unpacked**.
6. Select the extracted project folder.
7. Open [Facebook](https://www.facebook.com/).

Once loaded, the extension will be active on Facebook pages.

### Firefox (128 or newer)

Currently loadable via Firefox's Temporary Add-on feature:

1. Download or clone this repository.
2. Open Firefox and navigate to `about:debugging#/setup/runtime/this-firefox`.
3. Click **Load Temporary Add-on…**.
4. Select `manifest.json` in the project directory.
5. Open [Facebook](https://www.facebook.com/).

> Note: Temporary add-ons in Firefox are unloaded when the browser restarts; repeat step 3 to reload.

## How to Use

### Quick Toggle

Click the FB Feed Diet icon in your browser toolbar to instantly toggle filtering and view current diet statistics.

<img src="screenshots/popup.png" height="200" alt="Popup">

### Configure Settings

Open **"Options"** in the extension popup:

* Folding rules for the five main post categories.
* Title bar height, title snippet display, hover text preview, and more.
* Interface language (English / Traditional Chinese) and Light / Dark theme mode.
* Detection engine (**Relay** or **DOM**).

| Live Stats & Categories | Appearance & Detection Mode |
| :---: | :---: |
| <img src="screenshots/setting1.png" height="400" alt="Live Stats & Categories"> | <img src="screenshots/setting2.png" height="400" alt="Appearance & Detection Mode"> |

## Privacy & Permissions

FB Feed Diet is designed with a local-first privacy architecture:

* **Zero Data Collection**: No user data, browsing history, or feed content is collected, tracked, or transmitted. Zero telemetry, no backend servers, no external network requests.
* **100% Local Storage**: All preferences and filtering statistics are stored strictly on your local device (`chrome.storage.local`).
* **Minimal Permissions**:
  * Host permission (`*://*.facebook.com/*`): Only used to execute filtering logic on Facebook pages.
  * `storage`: Stores local preferences and statistics.
  * `scripting`: Synchronizes settings dynamically with already-open Facebook tabs.
* **Open Source & Transparent**: All code is open source and verifiable.
* **Privacy Policy**: For full terms, please refer to [PRIVACY.md](PRIVACY.md).

## Compatibility & Limitations

* Supports Firefox, Google Chrome, Microsoft Edge, and other Chromium-based browsers.
* Facebook frequently updates its DOM structure, post formatting, and internal data structures, which may cause classifiers to break over time.
* Provides two classification engines: **Relay** (direct inspection of Facebook's raw GraphQL data) and **DOM** (broader rendered page scanning).
* If you encounter unclassified posts or anomalies, feel free to report them on [Issues](https://github.com/Amppa/fb-feed-diet/issues) with the feed probe log attached.

## Acknowledgements

This project was inspired by:

* [ESUIT | ADBlocker for Facebook](https://addons.mozilla.org/zh-TW/firefox/addon/esuit-ad-blocker-for-facebook/)
* [F.B. Sponsored/Ad Post Blocker](https://github.com/browseraddonsupport-wq/fb-sponsored-ad-post-blocker)

FB Feed Diet adopts different classification pathways to ensure higher detection accuracy.

## License

This project is licensed under the [MIT License](LICENSE).
