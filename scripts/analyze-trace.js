'use strict';

const fs = require('fs');
const path = require('path');

function analyzeTrace(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`檔案不存在: ${filePath}`);
    return;
  }

  console.log(`正在讀取並分析火焰圖軌跡: ${filePath}...`);
  const rawData = fs.readFileSync(filePath, 'utf8');
  let trace;
  try {
    trace = JSON.parse(rawData);
  } catch (e) {
    console.error('JSON 解析失敗:', e.message);
    return;
  }

  const events = Array.isArray(trace) ? trace : (trace.traceEvents || []);
  console.log(`總事件數: ${events.length}`);

  let totalScripting = 0;
  let totalLayout = 0;
  let totalStyleRecalc = 0;
  let totalPaint = 0;
  let totalComposite = 0;
  let longTasks = [];
  let keyEvents = [];

  for (const ev of events) {
    const durMs = (ev.dur || 0) / 1000;
    if (durMs <= 0) continue;

    // 分類統計
    if (ev.name === 'EvaluateScript' || ev.name === 'FunctionCall' || ev.name === 'v8.compile' || ev.name === 'v8.run') {
      totalScripting += durMs;
    } else if (ev.name === 'Layout') {
      totalLayout += durMs;
    } else if (ev.name === 'UpdateLayoutTree' || ev.name === 'RecalculateStyles') {
      totalStyleRecalc += durMs;
    } else if (ev.name === 'Paint' || ev.name === 'Rasterize') {
      totalPaint += durMs;
    } else if (ev.name === 'CompositeLayers') {
      totalComposite += durMs;
    }

    if (ev.name === 'RunTask' && durMs > 50) {
      longTasks.push({
        ts: ev.ts / 1000,
        durMs: durMs
      });
    }

    if (ev.name === 'EventDispatch' && ev.args && ev.args.data) {
      const type = ev.args.data.type;
      if (type === 'keydown' || type === 'keyup' || type === 'click' || type === 'pointerdown') {
        keyEvents.push({
          type,
          durMs,
          ts: ev.ts / 1000
        });
      }
    }
  }

  console.log('\n=================== 📊 火焰圖耗時分類彙整 ===================');
  console.log(`🟨 JavaScript 腳本執行 (Scripting):  ${totalScripting.toFixed(2)} ms`);
  console.log(`🟣 樣式重算 (Recalculate Style):     ${totalStyleRecalc.toFixed(2)} ms`);
  console.log(`🟣 排版重排 (Layout / Reflow):       ${totalLayout.toFixed(2)} ms`);
  console.log(`🟢 繪製 (Paint / Raster):           ${totalPaint.toFixed(2)} ms`);
  console.log(`🟢 圖層合成 (Composite):            ${totalComposite.toFixed(2)} ms`);
  console.log('------------------------------------------------------------');
  const renderingTotal = totalLayout + totalStyleRecalc + totalPaint + totalComposite;
  console.log(`總渲染耗時 (Rendering/Layout):       ${renderingTotal.toFixed(2)} ms`);
  console.log(`偵測到長任務 (>50ms) 次數:           ${longTasks.length}`);

  if (keyEvents.length > 0) {
    console.log('\n🎯 關鍵事件 (Key / Pointer Events):');
    keyEvents.slice(-10).forEach(k => {
      console.log(` - [${k.type}] 耗時: ${k.durMs.toFixed(2)} ms (起點: ${k.ts.toFixed(1)} ms)`);
    });
  }

  if (longTasks.length > 0) {
    console.log('\n⚠️ 最嚴重長任務 Top 5:');
    longTasks.sort((a, b) => b.durMs - a.durMs).slice(0, 5).forEach((t, i) => {
      console.log(` #${i + 1} 耗時: ${t.durMs.toFixed(2)} ms`);
    });
  }
  console.log('============================================================\n');
}

const targetFile = process.argv[2] || path.resolve(__dirname, '../trace.json');
analyzeTrace(targetFile);
