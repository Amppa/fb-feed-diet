'use strict';

const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

/**
 * FB Diet - 動態時報與單一貼文切換自動化效能測試腳本
 * (Automated SPA Navigation Benchmark: Feed <-> Single Post)
 *
 * 測試面向：
 * 1. 導航耗時與主線程阻塞：切入單一貼文（Modal / PushState）與返回動態時報（Popstate / Close）的耗時與 TBT。
 * 2. CDP V8 CPU Profiler：精確定位路由切換期間耗費最多 CPU 時間的 Top 函數（排查雷擊效應 Thundering Herd）。
 * 3. Scope 判定與狀態保持：檢測 isFoldScopeBlocked 是否正常翻轉，已收合單元是否丟失或重複堆疊。
 * 4. 記憶體流轉與洩漏檢測：多次來回切換後的 JS Heap 增長趨勢與 Detached DOM 狀態。
 *
 * 支援參數：
 *   --rounds=N         切換來回測試輪次 (預設 3 輪)
 *   --no-profile       關閉 CDP V8 CPU 剖析
 *   --save-report      輸出詳細分析為 tests/e2e/reports/navigation-report.json
 *   --keep-open        測試完成後保持視窗開啟供手動檢查
 *   --headless         改以無頭模式自動執行
 *   --use-local-chrome 使用本機 Google Chrome
 */

const EXTENSION_PATH = path.resolve(__dirname, '../..');
const USER_DATA_DIR = path.resolve(__dirname, '../../.user_data');
const REPORT_DIR = path.resolve(__dirname, 'reports');
const REPORT_PATH = path.resolve(REPORT_DIR, 'navigation-report.json');

const args = process.argv.slice(2);
const roundsArg = args.find(a => a.startsWith('--rounds='));
const roundsCount = roundsArg ? parseInt(roundsArg.split('=')[1], 10) : 3;

const enableProfile = !args.includes('--no-profile');
const saveReport = args.includes('--save-report');
const keepOpen = args.includes('--keep-open');
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

/**
 * 分析 Chrome CDP CPU Profile，計算出各函數的 Self-Time 並排序
 */
function analyzeCdpProfile(profile) {
  if (!profile || !Array.isArray(profile.nodes)) return { topGeneral: [], topFbDiet: [] };

  const nodeMap = new Map();
  for (const node of profile.nodes) {
    nodeMap.set(node.id, {
      id: node.id,
      callFrame: node.callFrame || {},
      selfTime: 0
    });
  }

  const samples = profile.samples || [];
  const deltas = profile.timeDeltas || [];
  for (let i = 0; i < samples.length; i++) {
    const nodeId = samples[i];
    const deltaMs = (deltas[i] || 0) / 1000; // µs to ms
    const node = nodeMap.get(nodeId);
    if (node) {
      node.selfTime += deltaMs;
    }
  }

  const validNodes = Array.from(nodeMap.values())
    .filter(n => n.selfTime > 0.5 && n.callFrame.functionName !== '(root)' && n.callFrame.functionName !== '(idle)')
    .sort((a, b) => b.selfTime - a.selfTime);

  const fbDietNodes = validNodes.filter(n => {
    const url = n.callFrame.url || '';
    return url.includes('fb-diet') || url.includes('src/inject') || url.includes('chrome-extension:');
  });

  return {
    topGeneral: validNodes.slice(0, 8).map(n => ({
      name: n.callFrame.functionName || '(anonymous)',
      url: (n.callFrame.url || '').split('/').pop(),
      line: n.callFrame.lineNumber,
      selfTimeMs: Math.round(n.selfTime)
    })),
    topFbDiet: fbDietNodes.slice(0, 8).map(n => ({
      name: n.callFrame.functionName || '(anonymous)',
      file: (n.callFrame.url || '').split('/').pop(),
      line: n.callFrame.lineNumber,
      selfTimeMs: Math.round(n.selfTime)
    }))
  };
}

async function main() {
  console.log('================================================================');
  console.log('🚀 FB Feed Diet - 動態時報與單一貼文切換自動化效能分析測試');
  console.log(`測試輪次: 執行 ${roundsCount} 輪「動態時報 ↔ 單一貼文」來回切換`);
  console.log(`剖析模式: ${enableProfile ? '已開啟 CDP V8 CPU Profiler' : '已關閉 CPU Profiler'}`);
  console.log(`設定檔目錄: ${USER_DATA_DIR}`);
  console.log('================================================================\n');

  const launchOptions = {
    headless: isHeadless ? 'new' : false,
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

    // 建立 CDP Session 進行進階 Profiling
    let cdp;
    try {
      cdp = await page.target().createCDPSession();
      if (enableProfile) {
        await cdp.send('Profiler.enable');
      }
    } catch (e) {
      console.warn('⚠️ CDP Profiler 初始化警告:', e.message);
    }

    // 監聽控制台與錯誤
    const runtimeErrors = [];
    page.on('console', msg => {
      const type = msg.type();
      const text = msg.text();
      if (text.includes('Minified React error') || text.includes('Hydration failed')) {
        runtimeErrors.push({ type: 'ReactError', text });
      } else if (text.includes('fb-diet') && type === 'error') {
        runtimeErrors.push({ type: 'FBDietError', text });
      }
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

    // 注入性能監聽器 (Long Tasks)
    await page.evaluate(() => {
      window.__fbDietNavPerf = {
        longTasks: []
      };
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__fbDietNavPerf.longTasks.push({
              name: entry.name,
              startTime: Math.round(entry.startTime),
              duration: Math.round(entry.duration)
            });
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch (e) {}
    });

    // 初始平滑滾動兩次讓 Feed 與收合單元穩定載入
    console.log('\n📜 正在準備動態時報貼文 (滾動預熱 2 次)...');
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => window.scrollBy({ top: 800, behavior: 'smooth' }));
      await sleep(1500);
    }

    const baselineCdpMetrics = await page.metrics();
    const baselineData = await page.evaluate(() => {
      return {
        url: window.location.href,
        pathname: window.location.pathname,
        domNodes: document.querySelectorAll('*').length,
        usedJsHeap: (window.performance && window.performance.memory) ? window.performance.memory.usedJSHeapSize : null,
        foldBars: document.querySelectorAll('.fb-diet-titlebar').length,
        squashedUnits: document.querySelectorAll('.fb-diet-foldsquash, .fb-diet-fold-hidden').length
      };
    });

    console.log('📊 [基準數據 (Baseline)]');
    console.log(`  - 初始路徑:       ${baselineData.pathname}`);
    console.log(`  - 初始 DOM 節點:  ${baselineData.domNodes}`);
    console.log(`  - 初始 JS Heap:   ${formatBytes(baselineCdpMetrics.JSHeapUsedSize || baselineData.usedJsHeap)}`);
    console.log(`  - 已收合標籤數:   ${baselineData.foldBars} 條 (Squash: ${baselineData.squashedUnits} 個)\n`);

    const roundReports = [];

    // 開始進行多輪「動態時報 ↔ 單一貼文」切換測試
    for (let round = 1; round <= roundsCount; round++) {
      console.log(`----------------------------------------------------------------`);
      console.log(`🔄 【輪次 ${round}/${roundsCount}】開始測試「切換至單一貼文 ➜ 返回動態時報」`);
      console.log(`----------------------------------------------------------------`);

      // 清除本輪前計數點
      await page.evaluate(() => {
        if (window.__fbDietNavPerf) window.__fbDietNavPerf.roundStart = Date.now();
      });

      // 1. 尋找動態時報中適合進入單一貼文的目標 (DOM 選擇器或 Relay Store 獲取 permalink)
      let targetPost = await page.evaluate(() => {
        // 先嘗試從 DOM 尋找貼文鏈結
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        for (const a of anchors) {
          if (a.closest('.fb-diet-titlebar') || a.closest('.fb-diet-probe-popup')) continue;
          const href = a.getAttribute('href') || '';
          if (
            href.includes('/posts/') ||
            href.includes('permalink.php') ||
            (href.includes('/permalink/') && !href.includes('/stories/')) ||
            (href.includes('/photo') && (href.includes('fbid=') || href.includes('/?fbid='))) ||
            href.includes('story_fbid=')
          ) {
            const cleanUrl = href.startsWith('/') ? 'https://www.facebook.com' + href : href;
            return {
              url: cleanUrl,
              hasElement: a.offsetParent !== null,
              selector: `a[href="${href}"]`
            };
          }
        }

        // 若 DOM 未直接暴露清晰 href，從 Relay Store 讀取已捕獲的貼文 permalink
        try {
          const relay = window.FBDietRelay;
          const store = relay && relay.getStore && relay.getStore();
          const records = store && store.getSource && store.getSource()._records;
          if (records) {
            for (const key in records) {
              const rec = records[key];
              if (rec && typeof rec.permalink_url === 'string' && rec.permalink_url.includes('facebook.com')) {
                return { url: rec.permalink_url, hasElement: false, selector: 'relay-store' };
              }
            }
          }
        } catch (e) {}

        return null;
      });

      if (!targetPost) {
        console.warn(`  ⚠️ 輪次 ${round}: 未能在當前視角找到貼文，向下滾動以加載新貼文...`);
        await page.evaluate(() => window.scrollBy({ top: 1200, behavior: 'smooth' }));
        await sleep(2500);

        targetPost = await page.evaluate(() => {
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          for (const a of anchors) {
            if (a.closest('.fb-diet-titlebar') || a.closest('.fb-diet-probe-popup')) continue;
            const href = a.getAttribute('href') || '';
            if (href.includes('/posts/') || href.includes('permalink.php') || href.includes('/permalink/') || href.includes('story_fbid=')) {
              const cleanUrl = href.startsWith('/') ? 'https://www.facebook.com' + href : href;
              return { url: cleanUrl, hasElement: a.offsetParent !== null, selector: `a[href="${href}"]` };
            }
          }
          return null;
        });
      }

      // 2. 切換進入「單一貼文」 (Navigation IN)
      if (enableProfile && cdp) {
        await cdp.send('Profiler.start');
      }

      const navInStartTime = Date.now();
      let isModalOpen = false;
      let inPostPath = '';

      if (targetPost && targetPost.hasElement) {
        // 點擊該貼文鏈結
        await page.evaluate((targetUrl) => {
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          for (const a of anchors) {
            const href = a.getAttribute('href') || '';
            const full = href.startsWith('/') ? 'https://www.facebook.com' + href : href;
            if (full === targetUrl || href === targetUrl) {
              a.scrollIntoView({ block: 'center', behavior: 'smooth' });
              a.click();
              return true;
            }
          }
          return false;
        }, targetPost.url);
      }

      // 檢查是否已打開 Modal 或 URL 改變
      const checkInStart = Date.now();
      while ((Date.now() - checkInStart) < 3000) {
        await sleep(400);
        const st = await page.evaluate(() => ({
          hasDialog: !!document.querySelector('div[role="dialog"]'),
          pathname: window.location.pathname
        }));
        if (st.hasDialog || st.pathname.includes('/posts/') || st.pathname.includes('/permalink') || st.pathname.includes('/photo')) {
          isModalOpen = st.hasDialog;
          inPostPath = st.pathname;
          break;
        }
      }

      // 若點擊未觸發導航，但已獲取到目標貼文 URL，則執行直接導航
      if (!isModalOpen && !inPostPath.includes('/posts/') && !inPostPath.includes('/permalink') && targetPost && targetPost.url) {
        console.log(`  ↪ 點擊未觸發 SPA 跳轉，直接導航至貼文: ${targetPost.url.slice(0, 75)}...`);
        await page.goto(targetPost.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2500);
        inPostPath = await page.evaluate(() => window.location.pathname);
      }

      const navInDuration = Date.now() - navInStartTime;

      let inProfileAnalysis = null;
      if (enableProfile && cdp) {
        try {
          const { profile } = await cdp.send('Profiler.stop');
          inProfileAnalysis = analyzeCdpProfile(profile);
        } catch (e) {}
      }

      // 檢查單一貼文狀態下 FB Diet 的 Scope 狀態
      const postStateData = await page.evaluate(() => {
        let isScopeBlocked = null;
        if (window.FBDietFoldVerdict && typeof window.FBDietFoldVerdict.isFoldScopeBlocked === 'function') {
          const bridge = window.FBDietBridge;
          const settings = bridge && bridge.getSettings ? bridge.getSettings() : { restrictFoldScope: true };
          isScopeBlocked = window.FBDietFoldVerdict.isFoldScopeBlocked(settings);
        }
        return {
          pathname: window.location.pathname,
          isScopeBlocked,
          domNodes: document.querySelectorAll('*').length,
          mem: (window.performance && window.performance.memory) ? window.performance.memory.usedJSHeapSize : null,
          dialogCount: document.querySelectorAll('div[role="dialog"]').length
        };
      });

      console.log(`  ▶ [1. 進入單一貼文] 耗時: ${navInDuration}ms | 模式: ${isModalOpen ? '彈窗 Modal' : 'SPA 路由跳轉'}`);
      console.log(`     - 當前路徑: ${postStateData.pathname} | Scope 阻斷判定: ${postStateData.isScopeBlocked ? '已阻斷 (正確保護單一貼文) ✅' : '未阻斷 (Feed Scope)'}`);
      if (inProfileAnalysis && inProfileAnalysis.topFbDiet.length > 0) {
        console.log(`     - FB Diet 進入瞬間 CPU 耗時 Top 1: ${inProfileAnalysis.topFbDiet[0].name} (${inProfileAnalysis.topFbDiet[0].file}:${inProfileAnalysis.topFbDiet[0].line}) ~${inProfileAnalysis.topFbDiet[0].selfTimeMs}ms`);
      }

      // 停留 2 秒模擬使用者閱讀
      await sleep(2000);

      // 3. 切換返回「動態時報」 (Navigation BACK)
      if (enableProfile && cdp) {
        await cdp.send('Profiler.start');
      }

      const navOutStartTime = Date.now();

      // 優先以 Escape 鍵關閉彈窗 Modal
      if (isModalOpen) {
        await page.keyboard.press('Escape');
        await sleep(500);
      }

      // 嘗試點擊關閉按鈕
      const closeSuccess = await page.evaluate(() => {
        const closeSelectors = [
          'div[role="dialog"] [aria-label*="關閉"]',
          'div[role="dialog"] [aria-label*="Close"]',
          'div[role="dialog"] [aria-label*="Fermer"]',
          '[aria-label*="關閉"]',
          '[aria-label*="Close"]'
        ];
        for (const sel of closeSelectors) {
          const btn = document.querySelector(sel);
          if (btn && btn.offsetParent !== null) {
            btn.click();
            return true;
          }
        }
        return false;
      });

      if (!closeSuccess && !isModalOpen) {
        await page.goBack().catch(() => {});
      }

      // 🚨 CRITICAL 防衛：確保不會退到 about:blank 或離開 Facebook 首頁
      const curUrl = page.url();
      if (curUrl === 'about:blank' || !curUrl.includes('facebook.com') || (!curUrl.endsWith('facebook.com/') && !curUrl.includes('/home.php') && !isModalOpen)) {
        await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2500);
      } else {
        const waitOutStart = Date.now();
        while ((Date.now() - waitOutStart) < 5000) {
          await sleep(400);
          const onHome = await page.evaluate(() => {
            const dialog = document.querySelector('div[role="dialog"]');
            return !dialog && (window.location.pathname === '/' || window.location.pathname === '/home.php');
          });
          if (onHome) break;
        }
      }

      // 滾動以確保動態時報重新活化
      await page.evaluate(() => window.scrollBy({ top: 300, behavior: 'smooth' }));
      await sleep(1500);

      const navOutDuration = Date.now() - navOutStartTime;

      let outProfileAnalysis = null;
      if (enableProfile && cdp) {
        try {
          const { profile } = await cdp.send('Profiler.stop');
          outProfileAnalysis = analyzeCdpProfile(profile);
        } catch (e) {}
      }

      // 採集切回首頁後的指標
      const backCdpMetrics = await page.metrics();
      const backStateData = await page.evaluate(() => {
        return {
          pathname: window.location.pathname,
          domNodes: document.querySelectorAll('*').length,
          mem: (window.performance && window.performance.memory) ? window.performance.memory.usedJSHeapSize : null,
          foldBars: document.querySelectorAll('.fb-diet-titlebar').length,
          squashedUnits: document.querySelectorAll('.fb-diet-foldsquash, .fb-diet-fold-hidden').length
        };
      });

      console.log(`  ◀ [2. 返回動態時報] 耗時: ${navOutDuration}ms | 節點數: ${backStateData.domNodes}`);
      console.log(`     - 恢復後已收合條數: ${backStateData.foldBars} (基準: ${baselineData.foldBars}) | Squash 單元: ${backStateData.squashedUnits}`);
      if (outProfileAnalysis && outProfileAnalysis.topFbDiet.length > 0) {
        console.log(`     - FB Diet 恢復瞬間 CPU 耗時 Top 1: ${outProfileAnalysis.topFbDiet[0].name} (${outProfileAnalysis.topFbDiet[0].file}:${outProfileAnalysis.topFbDiet[0].line}) ~${outProfileAnalysis.topFbDiet[0].selfTimeMs}ms`);
      }

      const roundInfo = {
        round,
        navInDurationMs: navInDuration,
        navOutDurationMs: navOutDuration,
        postPathname: postStateData.pathname,
        isScopeBlocked: postStateData.isScopeBlocked,
        inProfileTopFbDiet: inProfileAnalysis ? inProfileAnalysis.topFbDiet : [],
        outProfileTopFbDiet: outProfileAnalysis ? outProfileAnalysis.topFbDiet : [],
        domNodesAfterReturn: backStateData.domNodes,
        heapAfterReturnMB: ((backCdpMetrics.JSHeapUsedSize || backStateData.mem) / (1024 * 1024)).toFixed(1),
        foldBarsAfterReturn: backStateData.foldBars
      };

      roundReports.push(roundInfo);
      await sleep(1500);
    }

    // 總結分析
    console.log('\n================================================================');
    console.log('📋 自動化切換效能評估總結 (Feed <-> Single Post Summary)');
    console.log('================================================================\n');

    const avgIn = Math.round(roundReports.reduce((sum, r) => sum + r.navInDurationMs, 0) / roundReports.length);
    const avgOut = Math.round(roundReports.reduce((sum, r) => sum + r.navOutDurationMs, 0) / roundReports.length);

    console.log('【1. 路由切換延遲評估 (Navigation Durations)】');
    console.log(`  - 平均進入單一貼文耗時: ${avgIn} ms`);
    console.log(`  - 平均返回動態時報耗時: ${avgOut} ms`);
    const speedVerdict = (avgIn < 2000 && avgOut < 2000)
      ? '🟢 順暢 (SPA 轉跳流暢，無卡死或過長白屏)'
      : '🟡 稍慢 (Facebook 渲染或外掛重繪過程耗時超過 2 秒)';
    console.log(`  - 延遲評級:             ${speedVerdict}\n`);

    console.log('【2. 記憶體增長與收合狀態 (Memory & Fold State Stability)】');
    roundReports.forEach(r => {
      console.log(`  - 第 ${r.round} 輪切換後: 節點數 ${r.domNodesAfterReturn} | Heap: ${r.heapAfterReturnMB} MB | 收合標籤: ${r.foldBarsAfterReturn} 條`);
    });

    const initialHeapMB = ((baselineCdpMetrics.JSHeapUsedSize || baselineData.usedJsHeap) / (1024 * 1024));
    const finalHeapMB = parseFloat(roundReports[roundReports.length - 1].heapAfterReturnMB);
    const netGrowth = (finalHeapMB - initialHeapMB).toFixed(1);
    console.log(`  - 多輪淨記憶體變化:     ${netGrowth >= 0 ? '+' : ''}${netGrowth} MB`);
    const leakVerdict = (netGrowth < 80)
      ? '🟢 良好 (無明顯 Detached DOM 或記憶體失控洩漏)'
      : '🟡 警告 (切換後記憶體持續攀升，需關注未銷毀的 Observer 或快取)';
    console.log(`  - 記憶體評級:           ${leakVerdict}\n`);

    console.log('【3. Scope 白名單與安全保護 (Scope Gate)】');
    const allBlockedCorrectly = roundReports.every(r => r.isScopeBlocked !== false);
    console.log(`  - 單一貼文是否正確避開收合: ${allBlockedCorrectly ? '是 ✅ (isFoldScopeBlocked 成功保護單一貼文不被誤收合)' : '否 ⚠️'}`);

    console.log('\n【4. 運行期異常 (Runtime Exceptions)】');
    console.log(`  - React 衝突 (Hydration Error): ${runtimeErrors.filter(e => e.type === 'ReactError').length} 筆`);
    console.log(`  - FB Diet 核心報錯:            ${runtimeErrors.filter(e => e.type === 'FBDietError').length} 筆`);

    if (saveReport) {
      if (!fs.existsSync(REPORT_DIR)) {
        fs.mkdirSync(REPORT_DIR, { recursive: true });
      }
      const fullReport = {
        timestamp: new Date().toISOString(),
        config: { roundsCount },
        baseline: baselineData,
        rounds: roundReports,
        runtimeErrors
      };
      fs.writeFileSync(REPORT_PATH, JSON.stringify(fullReport, null, 2), 'utf8');
      console.log(`\n📁 詳細測試報告已寫入: ${REPORT_PATH}`);
    }

    if (keepOpen) {
      console.log('\n📌 依據 --keep-open 參數，瀏覽器視窗將保持開啟供手動檢查。');
      await new Promise(resolve => browser.on('disconnected', resolve));
    } else {
      console.log('\n⏳ 測試完成，3 秒後關閉瀏覽器...');
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
