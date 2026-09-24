'use strict';
/**
 * FB Diet test runner: `node tests/run.js`
 * Loads every *.test.js in this folder and reports a combined result.
 */
const fs = require('fs');
const path = require('path');
const { Checker } = require('./harness');

const files = fs
  .readdirSync(__dirname)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

let failedSuites = 0;

async function runSuite(file) {
  const checker = new Checker(file);
  const mod = require(path.join(__dirname, file));
  try {
    await mod.run(checker);
  } catch (e) {
    checker.ok('suite did not throw: ' + file, false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
  }
  if (!checker.report()) failedSuites += 1;
}

(async () => {
  for (const file of files) {
    await runSuite(file);
  }

  console.log('\n========================================');
  if (failedSuites === 0) {
    console.log('ALL SUITES PASSED (' + files.join(', ') + ')');
  } else {
    console.log('FAILED SUITES: ' + failedSuites + '/' + files.length);
    process.exitCode = 1;
  }
})();
