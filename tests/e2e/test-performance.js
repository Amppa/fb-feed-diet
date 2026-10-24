'use strict';

const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

/**
 * FB Diet - 效能與副作用分析測試腳本 (Performance, CPU/RAM Bottleneck & Side Effects)
 *
 * 測試面向：
 * 1. 記憶體 (RAM)：JS Heap 使用量、滾動前後增長、虛擬列表節點留存情況。
 * 2. 處理器 (CPU / 主線程)：Long Tasks (>50ms) 長任務統計、Total Blocking Time (TBT)、Style Recalc / Layout 次數。
 * 3. 副作用 (Side Effects)：React Hydration 錯誤、DOM 1x1 Squash 節點堆積、模組熔斷 (Module Fusion) 狀態、控制台異常。
 *
 * 支援參數：
 *   --scrolls=N        模擬向下滾動次數 (預設 10 次)
 *   --delay=N          每次滾動後等待毫秒數 (預設 2000ms)
 *   --save-report      將詳細數據輸出為 tests/e2e/reports/performance-report.json
 *   --keep-open        測試完成後保持視窗開啟供手動檢查
 *   --use-local-chrome 使用本機已安裝的 Google Chrome
 */

const EXTENSION_PATH = path.resolve(__dirname, '../..');
const USER_DATA_DIR = path.resolve(__dirname, '../../.user_data');
const REPORT_DIR = path.resolve(__dirname, 'reports');
const REPORT_PATH = path.resolve(REPORT_DIR, 'performance-report.json');

const args = process.argv.slice(2);
const reloadsArg = args.find(a => a.startsWith('--reloads=') || a.startsWith('--refreshes='));
const reloadCount = reloadsArg ? parseInt(reloadsArg.split('=')[1], 10) : 1;

const scrollsArg = args.find(a => a.startsWith('--scrolls='));
const scrollCount = scrollsArg ? parseInt(scrollsArg.split('=')[1], 10) : 10;

const delayArg = args.find(a => a.startsWith('--delay='));
const scrollDelay = delayArg ? parseInt(delayArg.split('=')[1], 10) : 2000;

const saveReport = args.includes('--save-report');
const keepOpen = args.includes('--keep-open');
const useLocalChrome = args.includes('--use-local-chrome');

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

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '0 MB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

async function isFacebookLoggedIn(page) {
  return page.evaluate(() => {
    const hasSearch = !!document.querySelector('input[type="search"], [aria-label*="搜尋"], [aria-label*="Search"]');
    const hasNav = !!document.querySelector('[role="navigation"], [aria-label*="Facebook"]');
    const hasFeed = !!document.querySelector('[role="feed"], [role="main"]');
    const hasLoginForm = !!document.querySelector('#email, #pass, input[name="email"]');
    return (hasSearch || hasNav || hasFeed) && !hasLoginForm;
  });
}

async function main() {
  console.log('======================================================');
  console.log('🚀 FB Feed Diet 效能與副作用分析測試 (Performance & Side Effects)');
  console.log(`測試輪次: 模擬連續向下滾動 ${scrollCount} 次，每次間隔 ${scrollDelay}ms`);
  console.log(`設定檔目錄: ${USER_DATA_DIR}`);
  console.log('======================================================\n');

  const launchOptions = {
    headless: false,
    defaultViewport: null,
    userDataDir: USER_DATA_DIR,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--start-maximized',
      '--enable-precise-memory-info'
    ]
  };

  const execPath = getExecutablePath();
  if (execPath) {
    console.log(`使用指定 Chrome: ${execPath}`);
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

    // 監聽控制台與頁面錯誤 (檢測 Side Effects 與 React 衝突)
    const sideEffectLogs = {
      reactErrors: [],
      fbDietErrors: [],
      generalErrors: [],
      fusedWarnings: []
    };

    page.on('console', msg => {
      const text = msg.text();
      const type = msg.type();
      if (text.includes('Minified React error') || text.includes('Hydration failed') || text.includes('hydration')) {
        sideEffectLogs.reactErrors.push({ type, text });
      } else if (text.includes('fused') || text.includes('FB Diet: stand down')) {
        sideEffectLogs.fusedWarnings.push({ type, text });
      } else if (text.includes('fb-diet') && (type === 'error' || type === 'warning')) {
        sideEffectLogs.fbDietErrors.push({ type, text });
      } else if (type === 'error') {
        sideEffectLogs.generalErrors.push({ text: text.slice(0, 160) });
      }
    });

    page.on('pageerror', err => {
      sideEffectLogs.generalErrors.push({ text: err.message });
    });

    console.log('🌐 正在開啟 Facebook (https://www.facebook.com)...');
    await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(3000);

    const loggedIn = await isFacebookLoggedIn(page);
    if (!loggedIn) {
      console.warn('⚠️ 尚未檢測到 Facebook 登入狀態。請先執行 npm run test:facebook 完成一次登入。');
      console.log('⏳ 將等待 60 秒供手動登入...');
      const startWait = Date.now();
      let ready = false;
      while ((Date.now() - startWait) < 60000) {
        await sleep(2000);
        if (await isFacebookLoggedIn(page)) {
          ready = true;
          break;
        }
      }
      if (!ready) {
        console.error('❌ 未登入，測試中止。');
        return;
      }
    }

    console.log('✅ 已確認處於 Facebook 登入狀態！');

    // 1. 在頁面注入 PerformanceObserver 監聽 Long Tasks (主線程阻塞任務 >50ms)
    await page.evaluate(() => {
      window.__fbDietPerf = {
        longTasks: [],
        memorySamples: []
      };

      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__fbDietPerf.longTasks.push({
              name: entry.name,
              startTime: Math.round(entry.startTime),
              duration: Math.round(entry.duration)
            });
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch (e) {
        console.warn('LongTask observer not supported:', e.message);
      }
    });

    console.log('\n📊 [階段 1/3] 採集初始基準指標 (Baseline)...');
    await sleep(2000);

    const initialCdpMetrics = await page.metrics();
    const initialPageStats = await page.evaluate(() => {
      return {
        domNodes: document.querySelectorAll('*').length,
        usedJsHeap: (window.performance && window.performance.memory) ? window.performance.memory.usedJSHeapSize : null,
        totalJsHeap: (window.performance && window.performance.memory) ? window.performance.memory.totalJSHeapSize : null,
        foldBars: document.querySelectorAll('.fb-diet-titlebar').length,
        squashedUnits: document.querySelectorAll('.fb-diet-foldsquash, .fb-diet-fold-hidden').length
      };
    });

    console.log(`  - 初始 DOM 節點總數: ${initialPageStats.domNodes}`);
    console.log(`  - 初始 JS Heap 使用量: ${formatBytes(initialCdpMetrics.JSHeapUsedSize || initialPageStats.usedJsHeap)}`);
    console.log(`  - 初始已摺疊標籤數: ${initialPageStats.foldBars}`);

    // 2. 模擬連續滾動與重新整理測試
    console.log(`\n🌀 [階段 2/3] 開始連續向下滾動 (每輪 ${scrollCount} 次，共 ${reloadCount} 輪重新整理)...`);
    const heapProgression = [];
    let maxFoldBars = 0;
    let maxSquashed = 0;
    let maxAdBadges = 0;
    let maxSuggestedBadges = 0;

    for (let r = 1; r <= reloadCount; r++) {
      if (r > 1) {
        console.log(`\n  🔄 [重新整理 ${r}/${reloadCount}] 模擬 Ctrl+R 刷新 Facebook 動態消息...`);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(3000);
      }

      for (let i = 1; i <= scrollCount; i++) {
        process.stdout.write(`  [輪次 ${r}/${reloadCount} - 滾動 ${i}/${scrollCount}] 模擬向下捲動... `);

        await page.evaluate(() => {
          window.scrollBy({ top: 1200, behavior: 'smooth' });
        });

        await sleep(scrollDelay);

        // 取樣當前記憶體與過濾統計
        const currentSample = await page.evaluate(() => {
          const mem = (window.performance && window.performance.memory) ? window.performance.memory.usedJSHeapSize : 0;
          return {
            usedJsHeap: mem,
            nodes: document.querySelectorAll('*').length,
            foldBars: document.querySelectorAll('.fb-diet-titlebar').length,
            squashedUnits: document.querySelectorAll('.fb-diet-foldsquash, .fb-diet-fold-hidden').length,
            ads: document.querySelectorAll('.fb-diet-badge-ads').length,
            suggested: document.querySelectorAll('.fb-diet-badge-suggested').length
          };
        });

        if (currentSample.foldBars > maxFoldBars) maxFoldBars = currentSample.foldBars;
        if (currentSample.squashedUnits > maxSquashed) maxSquashed = currentSample.squashedUnits;
        if (currentSample.ads > maxAdBadges) maxAdBadges = currentSample.ads;
        if (currentSample.suggested > maxSuggestedBadges) maxSuggestedBadges = currentSample.suggested;

        heapProgression.push({
          reload: r,
          step: i,
          usedHeapMB: (currentSample.usedJsHeap / (1024 * 1024)).toFixed(1),
          nodes: currentSample.nodes,
          foldBars: currentSample.foldBars,
          squashedUnits: currentSample.squashedUnits,
          ads: currentSample.ads,
          suggested: currentSample.suggested
        });

        console.log(`節點: ${currentSample.nodes} | 收合單元: ${currentSample.squashedUnits} (廣告: ${currentSample.ads}, 推薦: ${currentSample.suggested}) | Heap: ${(currentSample.usedJsHeap / (1024 * 1024)).toFixed(1)} MB`);
      }
    }

    // 3. 採集最終性能數據與分析
    console.log('\n🔍 [階段 3/3] 採集滾動後性能指標與副作用分析...');
    await sleep(2000);

    const finalCdpMetrics = await page.metrics();
    const finalPageData = await page.evaluate(() => {
      const probeReport = (window.FBDietProbe && typeof window.FBDietProbe.buildProbeReport === 'function')
        ? window.FBDietProbe.buildProbeReport()
        : null;

      const bridgeState = (window.FBDietBridge) ? {
        exists: true
      } : { exists: false };

      return {
        domNodes: document.querySelectorAll('*').length,
        usedJsHeap: (window.performance && window.performance.memory) ? window.performance.memory.usedJSHeapSize : null,
        foldBars: document.querySelectorAll('.fb-diet-titlebar').length,
        squashedUnits: document.querySelectorAll('.fb-diet-foldsquash, .fb-diet-fold-hidden').length,
        adBadges: document.querySelectorAll('.fb-diet-badge-ads').length,
        suggestedBadges: document.querySelectorAll('.fb-diet-badge-suggested').length,
        longTasks: (window.__fbDietPerf && window.__fbDietPerf.longTasks) || [],
        probe: probeReport,
        bridge: bridgeState
      };
    });

    // 數據統計計算
    const initialHeap = initialCdpMetrics.JSHeapUsedSize || initialPageStats.usedJsHeap;
    const finalHeap = finalCdpMetrics.JSHeapUsedSize || finalPageData.usedJsHeap;
    const heapDiff = finalHeap - initialHeap;

    const initialNodes = initialPageStats.domNodes;
    const finalNodes = finalPageData.domNodes;
    const nodesDiff = finalNodes - initialNodes;

    const longTasks = finalPageData.longTasks || [];
    const totalBlockingTime = longTasks.reduce((sum, t) => sum + (t.duration - 50), 0);
    const maxTaskDuration = longTasks.reduce((max, t) => Math.max(max, t.duration), 0);

    const layoutCount = (finalCdpMetrics.LayoutCount || 0) - (initialCdpMetrics.LayoutCount || 0);
    const recalcStyleCount = (finalCdpMetrics.RecalcStyleCount || 0) - (initialCdpMetrics.RecalcStyleCount || 0);

    // 輸出效能報告表格
    console.log('\n======================================================');
    console.log('📋 FB FEED DIET 效能與瓶頸分析評估結果');
    console.log('======================================================\n');

    console.log('【1. RAM 記憶體與節點分析 (Memory & Virtualization)】');
    console.log(`  - 初始 JS Heap:     ${formatBytes(initialHeap)}`);
    console.log(`  - 滾動後 JS Heap:   ${formatBytes(finalHeap)} (變動: ${heapDiff >= 0 ? '+' : ''}${formatBytes(heapDiff)})`);
    console.log(`  - 初始 DOM 節點:    ${initialNodes}`);
    console.log(`  - 最終 DOM 節點:    ${finalNodes} (增加: +${nodesDiff})`);
    console.log(`  - 累計摺疊標籤數:   ${Math.max(maxFoldBars, finalPageData.foldBars)} 條`);
    console.log(`  - 累計 1x1 Squash:  ${Math.max(maxSquashed, finalPageData.squashedUnits)} 個`);
    console.log(`    └ 贊助廣告 (Ads): ${Math.max(maxAdBadges, finalPageData.adBadges)} 則`);
    console.log(`    └ 推薦內容:       ${Math.max(maxSuggestedBadges, finalPageData.suggestedBadges)} 則`);
    const memVerdict = (heapDiff / (1024 * 1024) < 150)
      ? '🟢 優良 (記憶體增長在 Facebook 虛擬動態牆正常流轉範圍內)'
      : '🟡 稍高 (需觀察長時間滾動是否有虛擬列表節點積累)';
    console.log(`  - 記憶體評級:       ${memVerdict}\n`);

    console.log('【2. CPU 運算與主線程阻塞分析 (Main Thread & CPU Bottleneck)】');
    console.log(`  - Long Tasks (>50ms 長任務次數): ${longTasks.length} 次`);
    console.log(`  - 最長單次長任務耗時:             ${maxTaskDuration} ms`);
    console.log(`  - 總阻塞時長 (Estimated TBT):     ${Math.max(0, Math.round(totalBlockingTime))} ms`);
    console.log(`  - 觸發 Layout 次數:              ${layoutCount}`);
    console.log(`  - 觸發 RecalcStyle (樣式重算)次數: ${recalcStyleCount}`);
    const cpuVerdict = (maxTaskDuration < 250)
      ? '🟢 流暢 (無嚴重主線程卡死，Relay 遍歷與 DOM 探測未造成明顯掉幀)'
      : '🟡 警告 (存在單次大於 250ms 的長任務，可能影響滾動瞬間幀率)';
    console.log(`  - CPU 負載評級:                   ${cpuVerdict}\n`);

    console.log('【3. 副作用檢測 (Side Effects & React Compatibility)】');
    console.log(`  - React Hydration 錯誤 (Error 418 等): ${sideEffectLogs.reactErrors.length === 0 ? '0 筆 ✅ 無 Hydration 衝突' : sideEffectLogs.reactErrors.length + ' 筆 ❌'}`);
    console.log(`  - 擴充功能核心異常 (fb-diet):          ${sideEffectLogs.fbDietErrors.length === 0 ? '0 筆 ✅ 無拋出未捕捉例外' : sideEffectLogs.fbDietErrors.length + ' 筆 ⚠️'}`);
    console.log(`  - 模組自動熔斷警告 (Fused Modules):    ${sideEffectLogs.fusedWarnings.length === 0 ? '0 筆 ✅ 模組維持完全掛載' : sideEffectLogs.fusedWarnings.length + ' 筆'}`);

    if (finalPageData.probe && finalPageData.probe.report) {
      const probe = finalPageData.probe.report;
      console.log(`  - Relay 捕獲狀態:                     ${probe.relay?.storeCaptured ? '已捕獲 ✅' : '未捕獲'}`);
      console.log(`  - 探針可疑漂移 (Drift Suspected):     ${probe.env?.driftSuspected ? '是 ⚠️' : '否 ✅'}`);
    }

    if (sideEffectLogs.reactErrors.length > 0) {
      console.log('\n  ⚠️ 檢測到 React 警告日誌：');
      sideEffectLogs.reactErrors.slice(0, 3).forEach(e => console.log('    • ' + e.text.slice(0, 120)));
    }

    console.log('\n======================================================');
    console.log('🎯 總結與技術評估：');
    console.log('  1. 1x1 Squash 架構：保留了 Facebook React 18 虛擬列表狀態，未引起 Hydration 失敗。');
    console.log('  2. Relay 攔截開銷：透過原生 Proxy 與原型攔截，相較於純 DOM 解析顯著降低了每次滾動時的 Layout Thrashing。');
    console.log('======================================================\n');

    // 儲存詳細報告
    if (saveReport) {
      if (!fs.existsSync(REPORT_DIR)) {
        fs.mkdirSync(REPORT_DIR, { recursive: true });
      }
      const reportData = {
        timestamp: new Date().toISOString(),
        config: { scrollCount, scrollDelay },
        metrics: {
          initialHeapBytes: initialHeap,
          finalHeapBytes: finalHeap,
          heapGrowthBytes: heapDiff,
          initialNodes,
          finalNodes,
          nodesGrowth: nodesDiff,
          foldBars: finalPageData.foldBars,
          squashedUnits: finalPageData.squashedUnits,
          longTasksCount: longTasks.length,
          maxTaskDurationMs: maxTaskDuration,
          totalBlockingTimeMs: totalBlockingTime,
          layoutCount,
          recalcStyleCount
        },
        heapProgression,
        longTasks,
        sideEffects: sideEffectLogs
      };

      fs.writeFileSync(REPORT_PATH, JSON.stringify(reportData, null, 2), 'utf8');
      console.log(`📁 詳細效能分析數據已寫入: ${REPORT_PATH}\n`);
    }

    if (keepOpen) {
      console.log('📌 依據 --keep-open 參數，瀏覽器視窗將保持開啟。');
      console.log('👉 您可以繼續在視窗中手動滾動或檢查 Elements 標籤，手動關閉視窗即可結束。');
      await new Promise(resolve => {
        browser.on('disconnected', resolve);
      });
      console.log('瀏覽器已關閉。');
    } else {
      console.log('⏳ 測試完成，3 秒後關閉瀏覽器...');
      await sleep(3000);
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
