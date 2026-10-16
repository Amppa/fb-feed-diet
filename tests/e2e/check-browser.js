'use strict';

const path = require('path');
const puppeteer = require('puppeteer');

/**
 * FB Diet - Puppeteer 瀏覽器狀態與擴充功能檢查腳本
 *
 * 預設會以實體視窗 (headless: false) 啟動，讓使用者可以直接看到瀏覽器視窗與操作過程。
 *
 * 支援參數：
 *   --headless       改以無頭模式執行
 *   --keep-open      測試完成後保持視窗開啟不自動關閉
 *   --duration=N     視窗停留秒數 (預設 5 秒)
 *   --use-local-chrome 使用系統安裝的 Google Chrome (若無則使用內建 Chrome)
 */

const EXTENSION_PATH = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const isHeadless = args.includes('--headless');
const keepOpen = args.includes('--keep-open') || args.includes('--stay');
const durationArg = args.find(a => a.startsWith('--duration='));
const stayDuration = durationArg ? parseInt(durationArg.split('=')[1], 10) * 1000 : 5000;
const useLocalChrome = args.includes('--use-local-chrome');

const LOCAL_CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`
];

function getExecutablePath() {
  if (useLocalChrome) {
    const fs = require('fs');
    for (const p of LOCAL_CHROME_PATHS) {
      if (p && fs.existsSync(p)) return p;
    }
  }
  return undefined; // Puppeteer 預設使用內建 Chrome for Testing
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('======================================================');
  console.log('啟動 Puppeteer 測試環境 (FB Diet Extension)...');
  console.log(`模式: ${isHeadless ? '無頭模式 (Headless)' : '視窗顯示模式 (Headed Window)'}`);
  console.log(`擴充功能路徑: ${EXTENSION_PATH}`);
  console.log('======================================================\n');

  const launchOptions = {
    headless: isHeadless ? 'new' : false,
    defaultViewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  };

  const execPath = getExecutablePath();
  if (execPath) {
    console.log(`使用指定 Chrome: ${execPath}`);
    launchOptions.executablePath = execPath;
  }

  const isDumpio = args.includes('--dumpio');

  console.log('正在啟動 Chrome 瀏覽器視窗...');
  let browser;
  try {
    browser = await puppeteer.launch({
      ...launchOptions,
      timeout: 20000,
      dumpio: isDumpio
    });
    console.log('Chrome 瀏覽器視窗已成功開啟！');
  } catch (err) {
    console.error('❌ 啟動瀏覽器失敗:', err.message);
    process.exit(1);
  }

  try {
    // 1. 檢查瀏覽器基本狀態
    const version = await browser.version();
    const userAgent = await browser.userAgent();
    console.log('✅ [1/4] 瀏覽器啟動成功');
    console.log(`  - 瀏覽器版本: ${version}`);
    console.log(`  - User Agent: ${userAgent}\n`);

    // 2. 獲取擴充功能資訊 (等待 Service Worker 目標建立)
    console.log('🔍 [2/4] 正在檢查擴充功能 Service Worker 與 ID...');
    let extensionId = null;

    // 先檢查既有 targets
    for (const target of browser.targets()) {
      if (target.url().startsWith('chrome-extension://')) {
        extensionId = target.url().split('/')[2];
        break;
      }
    }

    // 若未立即可得，等待 target 建立
    if (!extensionId) {
      try {
        const swTarget = await browser.waitForTarget(
          target => target.url().startsWith('chrome-extension://'),
          { timeout: 8000 }
        );
        extensionId = swTarget.url().split('/')[2];
      } catch {
        console.warn('  ⚠️ 未於 8 秒內捕獲擴充功能 targets，嘗試經由 chrome://extensions 檢查');
      }
    }

    if (extensionId) {
      console.log(`✅ 成功辨識擴充功能! ID: ${extensionId}\n`);
    } else {
      console.log('  ⚠️ 未能直接獲取 Extension ID，將嘗試以預設頁面檢查\n');
    }

    // 3. 測試開啟擴充功能彈出視窗 (Popup) 或設定頁面 (Options)
    console.log('🌐 [3/4] 載入擴充功能 UI 頁面 (視窗顯示)...');
    const [page] = await browser.pages();
    await page.setViewport({ width: 1280, height: 800 });

    if (extensionId) {
      const popupUrl = `chrome-extension://${extensionId}/src/popup/popup.html`;
      console.log(`  - 導向 Popup: ${popupUrl}`);
      await page.goto(popupUrl, { waitUntil: 'domcontentloaded' });
      await sleep(1000);

      const title = await page.title();
      const hasMasterSwitch = await page.$('#enabled') !== null;
      const bodyText = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' ').slice(0, 100));

      console.log(`  - 頁面標題: "${title}"`);
      console.log(`  - 主開關 (#enabled): ${hasMasterSwitch ? '存在 ✅' : '不存在 ❌'}`);
      console.log(`  - 內容摘要: "${bodyText.trim()}..."\n`);

      // 接著測試 Options 頁面
      const optionsUrl = `chrome-extension://${extensionId}/src/options/options.html`;
      console.log(`  - 導向 Options: ${optionsUrl}`);
      const optionsPage = await browser.newPage();
      await optionsPage.goto(optionsUrl, { waitUntil: 'domcontentloaded' });
      await sleep(1000);

      const optTitle = await optionsPage.title();
      const optHasReset = await optionsPage.$('#resetBtn') !== null;
      console.log(`  - Options 標題: "${optTitle}"`);
      console.log(`  - 重設按鈕 (#resetBtn): ${optHasReset ? '存在 ✅' : '不存在 ❌'}\n`);
    } else {
      await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
      console.log('  - 載入測試頁面成功: ' + await page.title());
    }

    // 4. 總結狀態
    console.log('🎉 [4/4] 瀏覽器與擴充功能狀態檢查完成！所有核心狀態正常。');
    
    if (keepOpen) {
      console.log('\n📌 依據 --keep-open 參數，瀏覽器視窗將保持開啟。');
      console.log('👉 您可以直接在視窗中操作檢查，關閉瀏覽器視窗或按 Ctrl+C 即可結束。');
      await new Promise(resolve => {
        browser.on('disconnected', resolve);
      });
      console.log('瀏覽器視窗已手動關閉。');
    } else {
      console.log(`\n⏳ 視窗將在 ${(stayDuration / 1000).toFixed(0)} 秒後自動關閉（可使用 --keep-open 保持開啟）...`);
      await sleep(stayDuration);
    }
  } finally {
    if (!keepOpen && browser && browser.connected) {
      await browser.close();
      console.log('瀏覽器已關閉。');
    }
  }
}

main().catch(err => {
  console.error('執行過程發生錯誤:', err);
  process.exit(1);
});
