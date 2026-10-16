'use strict';

const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

/**
 * FB Diet - Facebook 登入與動態牆過濾 E2E 測試腳本
 *
 * 預設會以實體視窗開啟 Facebook，並使用獨立的 .user_data 目錄保存登入狀態，
 * 只需要在視窗中登入一次，後續執行即可保持已登入狀態。
 *
 * 支援參數：
 *   --email=...      自動填入帳號 (可選)
 *   --password=...   自動填入密碼 (可選)
 *   --clean-session  清除現有已儲存的登入資料重新登入
 *   --use-local-chrome 使用系統安裝的 Google Chrome
 */

const EXTENSION_PATH = path.resolve(__dirname, '../..');
const USER_DATA_DIR = path.resolve(__dirname, '../../.user_data');

const args = process.argv.slice(2);
const cleanSession = args.includes('--clean-session');
const useLocalChrome = args.includes('--use-local-chrome');

const emailArg = args.find(a => a.startsWith('--email='));
const email = emailArg ? emailArg.split('=')[1] : (process.env.FB_EMAIL || null);

const passwordArg = args.find(a => a.startsWith('--password='));
const password = passwordArg ? passwordArg.split('=')[1] : (process.env.FB_PASSWORD || null);

const LOCAL_CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`
];

function getExecutablePath() {
  if (useLocalChrome) {
    for (const p of LOCAL_CHROME_PATHS) {
      if (p && fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function isFacebookLoggedIn(page) {
  return page.evaluate(() => {
    // 檢查登入後典型的導覽列、搜尋列或 feed 元件
    const hasSearch = !!document.querySelector('input[type="search"], [aria-label*="搜尋"], [aria-label*="Search"]');
    const hasNav = !!document.querySelector('[role="navigation"], [aria-label*="Facebook"]');
    const hasFeed = !!document.querySelector('[role="feed"], [role="main"]');
    const hasLoginForm = !!document.querySelector('#email, #pass, input[name="email"]');
    return (hasSearch || hasNav || hasFeed) && !hasLoginForm;
  });
}

async function main() {
  if (cleanSession && fs.existsSync(USER_DATA_DIR)) {
    console.log('🧹 正在清除現有 .user_data 登入工作階段...');
    try {
      fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    } catch (e) {
      console.warn('  ⚠️ 無法完全刪除目錄 (可能正被佔用):', e.message);
    }
  }

  console.log('======================================================');
  console.log('啟動 Facebook 登入與擴充功能測試環境...');
  console.log(`設定檔目錄: ${USER_DATA_DIR}`);
  console.log(`擴充功能路徑: ${EXTENSION_PATH}`);
  console.log('======================================================\n');

  const launchOptions = {
    headless: false,
    defaultViewport: null, // 全螢幕/自適應視窗
    userDataDir: USER_DATA_DIR,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--start-maximized'
    ]
  };

  const execPath = getExecutablePath();
  if (execPath) {
    console.log(`使用指定本機 Chrome: ${execPath}`);
    launchOptions.executablePath = execPath;
  }

  console.log('正在啟動 Chrome 瀏覽器視窗...');
  let browser;
  try {
    browser = await puppeteer.launch({
      ...launchOptions,
      timeout: 30000
    });
    console.log('Chrome 瀏覽器視窗已開啟！');
  } catch (err) {
    console.error('❌ 啟動瀏覽器失敗:', err.message);
    process.exit(1);
  }

  try {
    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();

    console.log('🌐 正在開啟 Facebook (https://www.facebook.com)...');
    await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(2000);

    // 檢查當前登入狀態
    let loggedIn = await isFacebookLoggedIn(page);

    if (loggedIn) {
      console.log('🎉 檢測到已處於 Facebook 登入狀態！');
    } else {
      console.log('🔒 尚未登入 Facebook。');

      // 若有提供帳密，嘗試自動填寫
      if (email && password) {
        console.log(`嘗試自動填入帳號: ${email}`);
        try {
          const emailInput = await page.$('#email, input[name="email"]');
          const passInput = await page.$('#pass, input[name="pass"]');
          const loginBtn = await page.$('button[name="login"], button[type="submit"]');

          if (emailInput && passInput) {
            await emailInput.type(email, { delay: 50 });
            await passInput.type(password, { delay: 50 });
            if (loginBtn) {
              await loginBtn.click();
              console.log('已點擊登入按鈕，等待登入回應...');
            }
          }
        } catch (fillErr) {
          console.warn('自動填寫登入資訊時發生提示:', fillErr.message);
        }
      }

      console.log('\n👉 請直接在開啟的 Chrome 瀏覽器視窗中手動登入 Facebook');
      console.log('   （如需輸入驗證碼、2FA 或簡訊認證，請於視窗中操作）');
      console.log('⏳ 正在等候登入完成...\n');

      // 等待登入成功 (最長等候 300 秒)
      const startTime = Date.now();
      const timeoutMs = 300000;
      while (!loggedIn && (Date.now() - startTime) < timeoutMs) {
        await sleep(2000);
        if (!browser.connected) {
          console.log('瀏覽器已關閉。');
          return;
        }
        loggedIn = await isFacebookLoggedIn(page);
      }

      if (loggedIn) {
        console.log('🎉 Facebook 登入成功！登入狀態已記錄於 .user_data 目錄，下次無需重複登入。\n');
      } else {
        console.log('⏰ 等候登入逾時（超過 5 分鐘）。');
      }
    }

    if (loggedIn) {
      console.log('🔍 正在檢查 FB Diet 擴充功能核心模組注入狀態...');
      await sleep(2000);

      const extensionStatus = await page.evaluate(() => {
        return {
          bridgeReady: typeof window.FBDietBridge !== 'undefined',
          relayReady: typeof window.FBDietRelay !== 'undefined',
          cometReady: typeof window.FBDietComet !== 'undefined',
          probeReady: typeof window.FBDietProbe !== 'undefined',
          foldBarsCount: document.querySelectorAll('.fb-diet-foldbar').length,
          squashedUnitsCount: document.querySelectorAll('.fb-diet-foldsquash').length
        };
      });

      console.log('------------------------------------------------------');
      console.log('FB Feed Diet 運作狀態：');
      console.log(`  - MAIN-world Bridge 模組: ${extensionStatus.bridgeReady ? '已載入 ✅' : '未載入 ❌'}`);
      console.log(`  - Relay 攔截模組:        ${extensionStatus.relayReady ? '已載入 ✅' : '未載入 ❌'}`);
      console.log(`  - Comet 模組:             ${extensionStatus.cometReady ? '已載入 ✅' : '未載入 ❌'}`);
      console.log(`  - 診斷 Probe 模組:        ${extensionStatus.probeReady ? '已載入 ✅' : '未載入 ❌'}`);
      console.log(`  - 當前已摺疊標籤條數:      ${extensionStatus.foldBarsCount}`);
      console.log(`  - 當前已隱藏/收合元件數:  ${extensionStatus.squashedUnitsCount}`);
      console.log('------------------------------------------------------\n');
    }

    console.log('📌 瀏覽器保持開啟中。您可以在視窗中瀏覽動態消息、測試過濾效果。');
    console.log('👉 測試完畢後，直接關閉 Chrome 視窗或在終端機按 Ctrl+C 即可結束。\n');

    await new Promise(resolve => {
      browser.on('disconnected', resolve);
    });
    console.log('瀏覽器已關閉，測試結束。');
  } finally {
    if (browser && browser.connected) {
      await browser.close();
    }
  }
}

main().catch(err => {
  console.error('執行過程發生錯誤:', err);
  process.exit(1);
});
