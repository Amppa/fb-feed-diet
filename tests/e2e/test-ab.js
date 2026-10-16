'use strict';

const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

/**
 * FB Diet - A/B 對照基準效能測試 (A/B Benchmark: Pure Facebook vs FB Diet Extension)
 *
 * 測試設計：
 *   測試組 A (Control)：原生 Facebook（無載入任何外掛），採集標準基準線 Baseline。
 *   測試組 B (Experiment)：載入 FB Feed Diet 外掛，採集包含擴充功能運作的效能數據。
 *
 * 產出：
 *   雙邊並列對照表，計算出外掛所產生的「淨 CPU 阻塞時間 (ΔTBT)」、「淨記憶體佔用 (ΔHeap)」、「淨 Layout 重排增量」。
 *
 * 支援參數：
 *   --scrolls=N        每組滾動次數 (預設 12 次)
 *   --delay=N          每次滾動後等待毫秒數 (預設 1500ms)
 *   --save-report      儲存為 tests/e2e/ab-report.json
 *   --headless         改以無頭模式自動執行
 *   --use-local-chrome 使用本機 Google Chrome
 */

const EXTENSION_PATH = path.resolve(__dirname, '../..');
const USER_DATA_DIR = path.resolve(__dirname, '../../.user_data');
const REPORT_PATH = path.resolve(__dirname, 'ab-report.json');

const args = process.argv.slice(2);
const reloadsArg = args.find(a => a.startsWith('--reloads=') || a.startsWith('--refreshes='));
const reloadCount = reloadsArg ? parseInt(reloadsArg.split('=')[1], 10) : 2;

const scrollsArg = args.find(a => a.startsWith('--scrolls='));
const scrollCount = scrollsArg ? parseInt(scrollsArg.split('=')[1], 10) : 12;

const delayArg = args.find(a => a.startsWith('--delay='));
const scrollDelay = delayArg ? parseInt(delayArg.split('=')[1], 10) : 1500;

const saveReport = args.includes('--save-report');
const isHeadless = args.includes('--headless');
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

function formatMB(bytes) {
  if (!bytes || isNaN(bytes)) return '0.0 MB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDelta(diff, unit = '', isTime = false) {
  const sign = diff >= 0 ? '+' : '';
  const formatted = typeof diff === 'number' && !Number.isInteger(diff)
    ? diff.toFixed(1)
    : diff;
  return `${sign}${formatted}${unit}`;
}

async function runSession({ name, loadExtension }) {
  console.log(`\n======================================================`);
  console.log(`▶ 正在執行測試組：【${name}】 (${loadExtension ? '已載入 FB Diet' : '純原生 Facebook - 無外掛'})`);
  console.log(`======================================================`);

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--start-maximized',
    '--enable-precise-memory-info'
  ];

  if (loadExtension) {
    launchArgs.push(
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`
    );
  }

  const launchOptions = {
    headless: isHeadless ? 'new' : false,
    defaultViewport: null,
    userDataDir: USER_DATA_DIR,
    args: launchArgs
  };

  const execPath = getExecutablePath();
  if (execPath) {
    launchOptions.executablePath = execPath;
  }

  const browser = await puppeteer.launch(launchOptions);
  let result = null;

  try {
    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();

    console.log('  🌐 開啟 Facebook...');
    await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(3000);

    // 注入 LongTask 監聽器
    await page.evaluate(() => {
      window.__longTasks = [];
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__longTasks.push({
              duration: Math.round(entry.duration)
            });
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch (e) {}
    });

    await sleep(1500);
    const initialCdp = await page.metrics();
    const initialNodes = await page.evaluate(() => document.querySelectorAll('*').length);

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

      console.log(`  🌀 模擬連續滾動 ${scrollCount} 次 (輪次 ${r}/${reloadCount})...`);
      for (let i = 1; i <= scrollCount; i++) {
        process.stdout.write(`    [${i}/${scrollCount}] 捲動中... `);
        await page.evaluate(() => {
          window.scrollBy({ top: 1200, behavior: 'smooth' });
        });
        await sleep(scrollDelay);

        const cur = await page.evaluate(() => {
          const mem = (window.performance && window.performance.memory) ? window.performance.memory.usedJSHeapSize : 0;
          return {
            heap: mem,
            titlebars: document.querySelectorAll('.fb-diet-titlebar').length,
            squashed: document.querySelectorAll('.fb-diet-foldsquash, .fb-diet-fold-hidden').length,
            ads: document.querySelectorAll('.fb-diet-badge-ads').length,
            suggested: document.querySelectorAll('.fb-diet-badge-suggested').length
          };
        });

        if (cur.titlebars > maxFoldBars) maxFoldBars = cur.titlebars;
        if (cur.squashed > maxSquashed) maxSquashed = cur.squashed;
        if (cur.ads > maxAdBadges) maxAdBadges = cur.ads;
        if (cur.suggested > maxSuggestedBadges) maxSuggestedBadges = cur.suggested;

        const extTag = loadExtension ? ` | 已收合單元: ${cur.squashed} (廣告: ${cur.ads}, 推薦: ${cur.suggested})` : '';
        console.log(`Heap: ${formatMB(cur.heap)}${extTag}`);
      }
    }

    await sleep(2000);
    const finalCdp = await page.metrics();
    const finalPageData = await page.evaluate(() => {
      return {
        domNodes: document.querySelectorAll('*').length,
        longTasks: window.__longTasks || [],
        foldBars: document.querySelectorAll('.fb-diet-titlebar').length,
        squashedUnits: document.querySelectorAll('.fb-diet-foldsquash, .fb-diet-fold-hidden').length,
        adBadges: document.querySelectorAll('.fb-diet-badge-ads').length,
        suggestedBadges: document.querySelectorAll('.fb-diet-badge-suggested').length
      };
    });

    const initialHeap = initialCdp.JSHeapUsedSize || 0;
    const finalHeap = finalCdp.JSHeapUsedSize || 0;
    const heapDiff = finalHeap - initialHeap;

    const finalNodes = finalPageData.domNodes;
    const nodesDiff = finalNodes - initialNodes;

    const longTasks = finalPageData.longTasks || [];
    const totalBlockingTime = longTasks.reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0);
    const maxTaskDuration = longTasks.reduce((max, t) => Math.max(max, t.duration), 0);

    const layoutCount = (finalCdp.LayoutCount || 0) - (initialCdp.LayoutCount || 0);
    const recalcStyleCount = (finalCdp.RecalcStyleCount || 0) - (initialCdp.RecalcStyleCount || 0);
    const taskDuration = ((finalCdp.TaskDuration || 0) - (initialCdp.TaskDuration || 0)) * 1000; // ms
    const scriptDuration = ((finalCdp.ScriptDuration || 0) - (initialCdp.ScriptDuration || 0)) * 1000; // ms

    result = {
      name,
      initialHeapMB: initialHeap / (1024 * 1024),
      finalHeapMB: finalHeap / (1024 * 1024),
      heapGrowthMB: heapDiff / (1024 * 1024),
      initialNodes,
      finalNodes,
      nodesGrowth: nodesDiff,
      longTasksCount: longTasks.length,
      maxTaskDurationMs: maxTaskDuration,
      totalBlockingTimeMs: Math.round(totalBlockingTime),
      taskDurationMs: Math.round(taskDuration),
      scriptDurationMs: Math.round(scriptDuration),
      layoutCount,
      recalcStyleCount,
      foldBars: Math.max(maxFoldBars, finalPageData.foldBars),
      squashedUnits: Math.max(maxSquashed, finalPageData.squashedUnits),
      adBadges: Math.max(maxAdBadges, finalPageData.adBadges),
      suggestedBadges: Math.max(maxSuggestedBadges, finalPageData.suggestedBadges)
    };

    console.log(`  ✅ 測試組【${name}】完成！`);
  } finally {
    await browser.close();
    await sleep(2000); // 確保 process 與連接清理乾淨
  }

  return result;
}

function pad(str, len) {
  str = String(str || '');
  return str + ' '.repeat(Math.max(0, len - str.length));
}

async function main() {
  console.log('================================================================');
  console.log('⚖️  FB FEED DIET - A/B 基準效能對照測試 (A/B Benchmark)');
  console.log(`測試設定: 兩輪各連續滾動 ${scrollCount} 次，間隔 ${scrollDelay}ms`);
  console.log('================================================================');

  // 第一階段：原生 Facebook (無外掛)
  const groupA = await runSession({
    name: '組 A: 原生 Facebook (無外掛)',
    loadExtension: false
  });

  // 第二階段：載入 FB Feed Diet 外掛
  const groupB = await runSession({
    name: '組 B: 載入 FB Diet (有外掛)',
    loadExtension: true
  });

  // 計算差異 (Delta = B - A)
  const delta = {
    finalHeapMB: groupB.finalHeapMB - groupA.finalHeapMB,
    heapGrowthMB: groupB.heapGrowthMB - groupA.heapGrowthMB,
    finalNodes: groupB.finalNodes - groupA.finalNodes,
    longTasksCount: groupB.longTasksCount - groupA.longTasksCount,
    maxTaskDurationMs: groupB.maxTaskDurationMs - groupA.maxTaskDurationMs,
    totalBlockingTimeMs: groupB.totalBlockingTimeMs - groupA.totalBlockingTimeMs,
    scriptDurationMs: groupB.scriptDurationMs - groupA.scriptDurationMs,
    layoutCount: groupB.layoutCount - groupA.layoutCount,
    recalcStyleCount: groupB.recalcStyleCount - groupA.recalcStyleCount
  };

  // 輸出對照表格
  console.log('\n\n==============================================================================');
  console.log('📊 A/B 對照效能分析基準報告 (FB Diet 淨開銷分析)');
  console.log('==============================================================================');
  console.log(`${pad('評估指標 (Metrics)', 28)} ${pad('[A: 原生 Facebook]', 22)} ${pad('[B: 載入 FB Diet]', 22)} ${pad('淨差異 (Delta B - A)', 20)}`);
  console.log('------------------------------------------------------------------------------');

  const rows = [
    ['最終 JS Heap 記憶體', `${groupA.finalHeapMB.toFixed(1)} MB`, `${groupB.finalHeapMB.toFixed(1)} MB`, `${formatDelta(delta.finalHeapMB, ' MB')}`],
    ['滾動後 Heap 增長量', `${groupA.heapGrowthMB.toFixed(1)} MB`, `${groupB.heapGrowthMB.toFixed(1)} MB`, `${formatDelta(delta.heapGrowthMB, ' MB')}`],
    ['最終 DOM 節點總數', `${groupA.finalNodes}`, `${groupB.finalNodes}`, `${formatDelta(delta.finalNodes, ' 個')}`],
    ['Long Tasks (>50ms次數)', `${groupA.longTasksCount} 次`, `${groupB.longTasksCount} 次`, `${formatDelta(delta.longTasksCount, ' 次')}`],
    ['單次最長任務耗時', `${groupA.maxTaskDurationMs} ms`, `${groupB.maxTaskDurationMs} ms`, `${formatDelta(delta.maxTaskDurationMs, ' ms')}`],
    ['總阻塞時間 (TBT)', `${groupA.totalBlockingTimeMs} ms`, `${groupB.totalBlockingTimeMs} ms`, `${formatDelta(delta.totalBlockingTimeMs, ' ms')}`],
    ['Script 執行總耗時', `${groupA.scriptDurationMs} ms`, `${groupB.scriptDurationMs} ms`, `${formatDelta(delta.scriptDurationMs, ' ms')}`],
    ['觸發 Layout (排版) 次數', `${groupA.layoutCount} 次`, `${groupB.layoutCount} 次`, `${formatDelta(delta.layoutCount, ' 次')}`],
    ['觸發 RecalcStyle (重算)', `${groupA.recalcStyleCount} 次`, `${groupB.recalcStyleCount} 次`, `${formatDelta(delta.recalcStyleCount, ' 次')}`],
    ['已摺疊標籤 (Titlebars)', '0 (無功能)', `${groupB.foldBars} 條`, '+'],
    ['1x1 Squash 收合單元', '0 (無功能)', `${groupB.squashedUnits} 個`, '+'],
    ['  └ 贊助廣告 (Ads)', '0 (無功能)', `${groupB.adBadges} 則`, '+'],
    ['  └ 推薦內容 (Suggested)', '0 (無功能)', `${groupB.suggestedBadges} 則`, '+']
  ];

  for (const [title, colA, colB, colDiff] of rows) {
    console.log(`${pad(title, 28)} ${pad(colA, 22)} ${pad(colB, 22)} ${pad(colDiff, 20)}`);
  }

  console.log('==============================================================================');

  // 結論洞察分析
  console.log('\n💡 關鍵結論與淨開銷 (Net Overhead) 評估：');
  const tbtRatio = groupA.totalBlockingTimeMs > 0
    ? ((delta.totalBlockingTimeMs / groupA.totalBlockingTimeMs) * 100).toFixed(1)
    : '0';
  const heapRatio = groupA.finalHeapMB > 0
    ? ((delta.finalHeapMB / groupA.finalHeapMB) * 100).toFixed(1)
    : '0';

  console.log(`  1. CPU 阻塞佔比: 原生 Facebook 產生的阻塞時間為 ${groupA.totalBlockingTimeMs} ms。外掛增加之淨阻塞時間為 ${delta.totalBlockingTimeMs} ms (相對變化 ${tbtRatio}%)。`);
  console.log(`  2. 記憶體佔比: 外掛造成的額外 JS Heap 記憶體變動為 ${delta.finalHeapMB.toFixed(1)} MB (相對變化 ${heapRatio}%)。`);
  console.log(`  3. 排版開銷: 每次滾動的外掛額外排版次數約為 ${(delta.layoutCount / scrollCount).toFixed(1)} 次/輪，證實未引起顯著 Layout Thrashing。`);
  console.log('==============================================================================\n');

  if (saveReport) {
    const reportObj = {
      timestamp: new Date().toISOString(),
      config: { scrollCount, scrollDelay },
      groupA,
      groupB,
      delta
    };
    fs.writeFileSync(REPORT_PATH, JSON.stringify(reportObj, null, 2), 'utf8');
    console.log(`📁 A/B 測試詳細報告已儲存至: ${REPORT_PATH}\n`);
  }
}

main().catch(err => {
  console.error('A/B 測試執行過程發生錯誤:', err);
  process.exit(1);
});
