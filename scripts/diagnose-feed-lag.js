'use strict';

const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

const EXTENSION_PATH = path.resolve(__dirname, '..');
const USER_DATA_DIR = path.resolve(__dirname, '../.user_data');

const LOCAL_CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`
];

function getExecutablePath() {
  for (const p of LOCAL_CHROME_PATHS) {
    if (p && fs.existsSync(p)) return p;
  }
  return undefined;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('===============================================================');
  console.log('🔍 Facebook 效能診斷工具 (INP / Long Tasks / 卡頓分析)');
  console.log('===============================================================');
  console.log(`設定檔路徑: ${USER_DATA_DIR}`);
  console.log('正在啟動 Chrome (開啟 DevTools + 實體視窗)...');

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: getExecutablePath(),
    userDataDir: USER_DATA_DIR,
    defaultViewport: null,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--start-maximized',
      '--auto-open-devtools-for-tabs'
    ]
  });

  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

  // 注入全域效能與 INP 監聽器
  await page.evaluateOnNewDocument(() => {
    window.__perfLogs = {
      longtasks: [],
      inpEvents: []
    };

    // 監聽 Long Tasks (>50ms)
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__perfLogs.longtasks.push({
            name: entry.name,
            startTime: Math.round(entry.startTime),
            duration: Math.round(entry.duration)
          });
          console.warn(`[Long Task ⚠️] 耗時: ${Math.round(entry.duration)}ms (起點: ${Math.round(entry.startTime)}ms)`);
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch (e) {}

    // 監聽 Event Timing (包含 INP 相關之 pointer / keyboard)
    try {
      const eventObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 50) {
            window.__perfLogs.inpEvents.push({
              name: entry.name,
              interactionId: entry.interactionId,
              duration: Math.round(entry.duration),
              processingStart: Math.round(entry.processingStart),
              processingEnd: Math.round(entry.processingEnd),
              target: entry.target ? (entry.target.tagName + (entry.target.className ? '.' + String(entry.target.className).split(' ')[0] : '')) : 'unknown'
            });
            console.warn(`[Slow Interaction 🔴] 類型: ${entry.name}, 耗時: ${Math.round(entry.duration)}ms, 目標:`, entry.target);
          }
        }
      });
      eventObserver.observe({ type: 'event', durationThreshold: 40, buffered: true });
    } catch (e) {}
  });

  console.log('正在導向至 https://www.facebook.com/ ...');
  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('等待頁面就緒 (10秒)... 請確認是否已登入');
  await sleep(10000);

  // 檢查 DOM 節點數量與狀態
  const initialMetrics = await page.evaluate(() => {
    return {
      domCount: document.getElementsByTagName('*').length,
      hasFeed: !!document.querySelector('[role="feed"]'),
      hasDialog: !!document.querySelector('[role="dialog"]')
    };
  });
  console.log(`初始狀態: DOM 節點數 = ${initialMetrics.domCount}, 找到 Feed: ${initialMetrics.hasFeed}`);

  // 模擬向下滾動 3 次，累積一點 Feed 內容
  console.log('模擬滾動 3 次加載貼文...');
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 1000));
    await sleep(2500);
  }

  const postScrollMetrics = await page.evaluate(() => {
    return {
      domCount: document.getElementsByTagName('*').length
    };
  });
  console.log(`滾動後: DOM 節點數增加至 ${postScrollMetrics.domCount}`);

  // 尋找動態牆中的圖片
  console.log('尋找貼文圖片 (feedImage)...');
  const feedImgFound = await page.evaluate(() => {
    const img = document.querySelector('img[data-imgperflogname="feedImage"]') ||
                document.querySelector('div[role="feed"] img[src*="fbcdn"]');
    if (!img) return false;
    img.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  });

  if (!feedImgFound) {
    console.log('⚠️ 未找到合適的 feedImage，保持瀏覽器視窗開啟供手動互動...');
  } else {
    await sleep(2000);
    console.log('📸 準備點擊貼文圖片，開始量測「點擊開圖 (Pointer INP)」...');

    const clickStart = Date.now();
    await page.evaluate(() => {
      const img = document.querySelector('img[data-imgperflogname="feedImage"]') ||
                  document.querySelector('div[role="feed"] img[src*="fbcdn"]');
      if (img) img.click();
    });

    // 等待燈箱出現
    let dialogOpened = false;
    for (let t = 0; t < 20; t++) {
      dialogOpened = await page.evaluate(() => !!document.querySelector('[role="dialog"]'));
      if (dialogOpened) break;
      await sleep(200);
    }
    const openElapsed = Date.now() - clickStart;
    console.log(`📸 燈箱彈窗已開啟！從點擊到顯示耗時: ~${openElapsed}ms`);

    await sleep(3000);

    console.log('❌ 準備按下 Esc 鍵關閉燈箱，開始量測「關閉退場 (Keyboard INP)」與錄製詳細火焰圖軌跡...');
    const tracePath = path.resolve(__dirname, '../trace-esc.json');
    await page.tracing.start({
      path: tracePath,
      categories: ['devtools.timeline', 'v8', 'blink.user_timing']
    });

    const escStart = Date.now();
    await page.keyboard.press('Escape');

    // 等待燈箱消失並完成下一幀
    let dialogClosed = false;
    for (let t = 0; t < 30; t++) {
      dialogClosed = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
      if (dialogClosed) break;
      await sleep(100);
    }
    const closeElapsed = Date.now() - escStart;
    console.log(`❌ 燈箱已關閉！從按下 Esc 到 DOM 移除耗時: ~${closeElapsed}ms`);

    try {
      await page.tracing.stop();
      console.log(`✅ 火焰圖軌跡已保存至: ${tracePath}`);
      // 調用 analyzeTrace
      try {
        const { execSync } = require('child_process');
        const analysisOutput = execSync(`node "${path.resolve(__dirname, 'analyze-trace.js')}" "${tracePath}"`, { encoding: 'utf8' });
        console.log(analysisOutput);
      } catch (e) {
        console.warn('軌跡分析解析失敗:', e.message);
      }
    } catch (e) {
      console.warn('Tracing 停止失敗:', e.message);
    }
  }

  // 匯出監聽到的卡頓分析
  await sleep(2000);
  const perfReport = await page.evaluate(() => {
    return {
      longtasksCount: window.__perfLogs?.longtasks?.length || 0,
      longtasks: window.__perfLogs?.longtasks?.slice(-10) || [],
      slowInteractions: window.__perfLogs?.inpEvents?.slice(-10) || [],
      totalDom: document.getElementsByTagName('*').length
    };
  });

  console.log('\n=================== 📊 效能診斷數據匯總 ===================');
  console.log(`總 DOM 節點數: ${perfReport.totalDom}`);
  console.log(`偵測到長任務 (>50ms) 次數: ${perfReport.longtasksCount}`);
  console.log('\n最近長任務 (Long Tasks) 列表:');
  perfReport.longtasks.forEach(t => console.log(` - 耗時 ${t.duration}ms (起點 ${t.startTime}ms)`));

  console.log('\n慢速互動 (INP > 50ms) 列表:');
  perfReport.slowInteractions.forEach(i => console.log(` - [${i.name}] 耗時 ${i.duration}ms, 目標元素: ${i.target}`));
  console.log('===========================================================\n');
  console.log('💡 視窗將保持開啟，你可以直接在視窗與 DevTools 中手動操作觀察。按 Ctrl+C 可結束程式。');

  await new Promise(() => {});
}

main().catch(err => {
  console.error('執行失敗:', err);
});
