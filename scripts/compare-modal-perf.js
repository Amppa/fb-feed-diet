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

function analyzeTrace(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  let data;
  try { data = JSON.parse(raw); } catch (e) { return null; }
  const events = Array.isArray(data) ? data : (data.traceEvents || []);

  let scripting = 0;
  let layout = 0;
  let style = 0;
  let keyupInp = 0;

  for (const ev of events) {
    const durMs = (ev.dur || 0) / 1000;
    if (durMs <= 0) continue;
    if (ev.name === 'EvaluateScript' || ev.name === 'FunctionCall' || ev.name === 'v8.compile') {
      scripting += durMs;
    } else if (ev.name === 'Layout') {
      layout += durMs;
    } else if (ev.name === 'UpdateLayoutTree' || ev.name === 'RecalculateStyles') {
      style += durMs;
    }

    if (ev.name === 'EventTiming' && ev.args?.data?.type === 'keyup') {
      keyupInp = ev.args.data.duration || durMs;
    }
  }

  return {
    eventsCount: events.length,
    scriptingMs: Math.round(scripting),
    layoutMs: Math.round(layout),
    styleMs: Math.round(style),
    keyupInpMs: Math.round(keyupInp)
  };
}

async function runBenchmark() {
  console.log('===============================================================');
  console.log('📊 Facebook 燈箱開關效能 A/B 差異自動化對照實測');
  console.log('===============================================================');

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
      '--start-maximized'
    ]
  });

  const page = (await browser.pages())[0];

  console.log('正在導向 Facebook 首頁...');
  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('等待頁面就緒並滾動動態牆...');
  await sleep(4000);
  for (let s = 0; s < 3; s++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await sleep(2000);
  }

  // 尋找動態牆中大圖
  const hasImage = await page.evaluate(() => {
    const img = Array.from(document.querySelectorAll('img')).find(img => {
      const src = img.src || '';
      return (src.includes('fbcdn') || src.includes('scontent')) && (img.width > 150 || img.offsetHeight > 150);
    });
    if (!img) return false;
    img.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  });

  if (!hasImage) {
    console.error('❌ 未能在動態牆中定位到大相片');
    await browser.close();
    return;
  }

  await sleep(2000);

  // ==========================================
  // 測試 1：新版 (Optimized / feat 分支版本)
  // ==========================================
  console.log('\n🟢 [測試 1/2] 正在量測【新版：0ms 即時退場 + 漸進式排版】...');
  const newTracePath = path.resolve(__dirname, '../trace-optimized.json');

  const newOpenStart = Date.now();
  await page.evaluate(() => {
    const img = Array.from(document.querySelectorAll('img')).find(img => {
      const src = img.src || '';
      return (src.includes('fbcdn') || src.includes('scontent')) && (img.width > 150 || img.offsetHeight > 150);
    });
    if (img) img.click();
  });

  // 等待相片檢視器出現
  for (let t = 0; t < 30; t++) {
    const isPhotoTheater = await page.evaluate(() => {
      return window.location.href.includes('/photo') ||
             Array.from(document.querySelectorAll('[role="dialog"]')).some(d => (d.getAttribute('aria-label') || '').includes('相片') || d.offsetWidth > 500);
    });
    if (isPhotoTheater) break;
    await sleep(100);
  }
  const newOpenTime = Date.now() - newOpenStart;
  console.log(` - 📸 相片檢視器開啟耗時: ~${newOpenTime}ms`);

  await sleep(2500);

  // 錄製關閉 Trace
  await page.tracing.start({ path: newTracePath, categories: ['devtools.timeline', 'v8'] });

  const newEscStart = Date.now();
  await page.keyboard.press('Escape');

  let newVisualExitTime = null;
  let newDomTeardownTime = null;

  for (let t = 0; t < 50; t++) {
    const status = await page.evaluate(() => {
      const photoDialog = Array.from(document.querySelectorAll('[role="dialog"]')).find(d => {
        return (d.getAttribute('aria-label') || '').includes('相片') || d.offsetWidth > 500;
      });
      if (!photoDialog) return { visible: false, inDom: false };
      const isExiting = photoDialog.classList.contains('fb-diet-dialog-exiting') ||
                        window.getComputedStyle(photoDialog).visibility === 'hidden' ||
                        window.getComputedStyle(photoDialog).opacity === '0';
      return { visible: !isExiting, inDom: true };
    });

    const now = Date.now();
    if (!status.visible && newVisualExitTime === null) {
      newVisualExitTime = now - newEscStart;
    }
    if (!status.inDom && newDomTeardownTime === null) {
      newDomTeardownTime = now - newEscStart;
      break;
    }
    await sleep(25);
  }

  try { await page.tracing.stop(); } catch (e) {}

  console.log(` - ⚡ 視覺退場時間 (Visual Hide): ~${newVisualExitTime !== null ? newVisualExitTime : 0}ms (大腦感知完成)`);
  console.log(` - 🔄 DOM 徹底卸載時間 (React Teardown): ~${newDomTeardownTime !== null ? newDomTeardownTime : 0}ms (背景清理)`);

  await sleep(2000);

  // ==========================================
  // 測試 2：舊版模擬 (Legacy / 無即時退場)
  // ==========================================
  console.log('\n🔴 [測試 2/2] 正在量測【舊版對照組：無 0ms 即時退場】...');
  const oldTracePath = path.resolve(__dirname, '../trace-legacy.json');

  // 停用即時退場 class 行為
  await page.evaluate(() => {
    window.__fbDietDisableInstantExit = true;
    const style = document.createElement('style');
    style.id = '__disable_instant_exit';
    style.textContent = `
      div[role="dialog"].fb-diet-dialog-exiting,
      div[aria-modal="true"].fb-diet-dialog-exiting {
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
      }
    `;
    document.head.appendChild(style);
  });

  // 重新點擊開圖
  const oldOpenStart = Date.now();
  await page.evaluate(() => {
    const img = Array.from(document.querySelectorAll('img')).find(img => {
      const src = img.src || '';
      return (src.includes('fbcdn') || src.includes('scontent')) && (img.width > 150 || img.offsetHeight > 150);
    });
    if (img) img.click();
  });

  for (let t = 0; t < 30; t++) {
    const isPhotoTheater = await page.evaluate(() => {
      return window.location.href.includes('/photo') ||
             Array.from(document.querySelectorAll('[role="dialog"]')).some(d => (d.getAttribute('aria-label') || '').includes('相片') || d.offsetWidth > 500);
    });
    if (isPhotoTheater) break;
    await sleep(100);
  }
  const oldOpenTime = Date.now() - oldOpenStart;
  console.log(` - 📸 相片檢視器開啟耗時: ~${oldOpenTime}ms`);

  await sleep(2500);

  await page.tracing.start({ path: oldTracePath, categories: ['devtools.timeline', 'v8'] });

  const oldEscStart = Date.now();
  await page.keyboard.press('Escape');

  let oldVisualExitTime = null;
  let oldDomTeardownTime = null;

  for (let t = 0; t < 50; t++) {
    const inDom = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[role="dialog"]')).some(d => {
        return (d.getAttribute('aria-label') || '').includes('相片') || d.offsetWidth > 500;
      });
    });
    const now = Date.now();
    if (!inDom) {
      oldVisualExitTime = now - oldEscStart;
      oldDomTeardownTime = now - oldEscStart;
      break;
    }
    await sleep(25);
  }

  try { await page.tracing.stop(); } catch (e) {}

  console.log(` - ⏳ 視覺退場時間 (Visual Hide): ~${oldVisualExitTime !== null ? oldVisualExitTime : 0}ms (等 React 完全卸載)`);
  console.log(` - 🔄 DOM 徹底卸載時間 (React Teardown): ~${oldDomTeardownTime !== null ? oldDomTeardownTime : 0}ms`);

  await browser.close();

  // 分析兩份 Tracing
  const newMetrics = analyzeTrace(newTracePath);
  const oldMetrics = analyzeTrace(oldTracePath);

  console.log('\n===============================================================');
  console.log('🏆 實測效能差異綜合對照表 (A/B Benchmark Comparison)');
  console.log('===============================================================');
  console.log(`指標項目                        舊版對照組 (Legacy)    新版優化 (Optimized)    改善幅度`);
  console.log(`---------------------------------------------------------------------------------`);
  
  const exitDiff = (oldVisualExitTime || 0) - (newVisualExitTime || 0);
  const exitPct = oldVisualExitTime ? Math.round((exitDiff / oldVisualExitTime) * 100) : 0;
  console.log(`視覺退場延遲 (Visual Latency)   ~${(oldVisualExitTime||0)} ms               ~${(newVisualExitTime||0)} ms             🟢 降幅 ${exitPct}% (縮短 ${exitDiff}ms)`);
  
  const openDiff = oldOpenTime - newOpenTime;
  const openPct = oldOpenTime ? Math.round((openDiff / oldOpenTime) * 100) : 0;
  console.log(`點進燈箱耗時 (Open Latency)     ~${oldOpenTime} ms               ~${newOpenTime} ms             ${newOpenTime <= oldOpenTime ? '🟢' : '⚪'} Δ: ${openDiff}ms`);

  if (newMetrics && oldMetrics) {
    console.log(`排版重排耗時 (Layout/Reflow)    ${oldMetrics.layoutMs} ms                 ${newMetrics.layoutMs} ms               ${newMetrics.layoutMs <= oldMetrics.layoutMs ? '🟢' : '⚪'} Δ: ${newMetrics.layoutMs - oldMetrics.layoutMs}ms`);
    console.log(`樣式重算耗時 (Style Recalc)     ${oldMetrics.styleMs} ms                 ${newMetrics.styleMs} ms               ${newMetrics.styleMs <= oldMetrics.styleMs ? '🟢' : '⚪'} Δ: ${newMetrics.styleMs - oldMetrics.styleMs}ms`);
    console.log(`JavaScript 腳本耗時 (Scripting) ${oldMetrics.scriptingMs} ms               ${newMetrics.scriptingMs} ms             ${newMetrics.scriptingMs <= oldMetrics.scriptingMs ? '🟢' : '⚪'} Δ: ${newMetrics.scriptingMs - oldMetrics.scriptingMs}ms`);
  }
  console.log('===============================================================\n');

  try {
    if (fs.existsSync(newTracePath)) fs.unlinkSync(newTracePath);
    if (fs.existsSync(oldTracePath)) fs.unlinkSync(oldTracePath);
  } catch (e) {}
}

runBenchmark().catch(err => {
  console.error('測試失敗:', err);
});
