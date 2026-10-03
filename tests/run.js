'use strict';
/**
 * FB Diet test runner: `node tests/run.js`
 * Loads every *.test.js in this folder — plus the local-only suites in testcase/ — and reports
 * a combined result.
 *
 * testcase/ holds real Facebook captures (probe reports, saved HTML) and the suites generated
 * from them. Those files carry personal data, post ids and URLs, so the directory is git-ignored:
 * a clone that has none simply has no such suite, and the area is skipped rather than failed.
 */
const fs = require('fs');
const path = require('path');
const { Checker } = require('./harness');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PRIVATE_DIR = path.join(__dirname, 'private');
const TESTCASE_DIR = path.join(PRIVATE_DIR, 'testcase');
const LEGACY_TESTCASE_DIR = path.join(__dirname, 'testcase');

/** Suites directly inside one directory, titled by their path relative to tests/. */
function listSuites(dir, label) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => ({ title: label + name, file: path.join(dir, name) }));
}

const publicSuites = listSuites(PUBLIC_DIR, 'public/');
const privateSuites = listSuites(PRIVATE_DIR, 'private/');
const rootSuites = listSuites(__dirname, '');
const localSuites = [
  ...listSuites(TESTCASE_DIR, 'private/testcase/'),
  ...listSuites(LEGACY_TESTCASE_DIR, 'testcase/')
];

const hasPrivate = privateSuites.length > 0;
const suites = hasPrivate
  ? [
      ...privateSuites,
      ...rootSuites,
      ...localSuites
    ]
  : [
      ...publicSuites,
      ...rootSuites
    ];

let failedSuites = 0;

async function runSuite(suite) {
  const checker = new Checker(suite.title);
  const mod = require(suite.file);
  try {
    await mod.run(checker);
  } catch (e) {
    checker.ok('suite did not throw: ' + suite.title, false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
  }
  if (!checker.report()) failedSuites += 1;
}

(async () => {
  for (const suite of suites) {
    await runSuite(suite);
  }

  console.log('\n========================================');
  if (hasPrivate) {
    if (publicSuites.length) {
      console.log('NOTICE: Executed tests/private/ (skipped tests/public/ mirror to avoid duplication)');
    }
  } else {
    if (!publicSuites.length) {
      console.log('NOTICE: tests/public/ has no test suites yet');
    }
    console.log('SKIPPED tests/private/ (private test suites — omitted in public mirror)');
  }
  if (failedSuites === 0) {
    console.log('ALL SUITES PASSED (' + suites.map((suite) => suite.title).join(', ') + ')');
  } else {
    console.log('FAILED SUITES: ' + failedSuites + '/' + suites.length);
    process.exitCode = 1;
  }
})();
