'use strict';
/** Contract test for the declarative probe stylesheet. */
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./harness');

function run(c) {
  const css = fs.readFileSync(path.join(ROOT, 'src', 'content', 'content.css'), 'utf8');
  const probe = fs.readFileSync(path.join(ROOT, 'src', 'inject', 'probe.js'), 'utf8');
  const manifest = fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8');

  for (const selector of [
    '.fb-diet-probe-holder',
    '.fb-diet-probe-group',
    '.fb-diet-probe-btn',
    '.fb-diet-probe-popup',
    '.fb-diet-probe-popup-row',
    '.fb-diet-probe-popup-spacer',
    '.fb-diet-probe-popup-fadeout',
    '@keyframes fb-diet-popup-in'
  ]) {
    c.ok('content.css owns ' + selector, css.indexOf(selector) !== -1);
  }

  c.ok('probe.js does not inject a stylesheet', probe.indexOf('injectProbeStyles') === -1);
  c.ok('probe.js does not create style elements', probe.indexOf("createElement('style')") === -1);
  c.ok('probe.js does not retain the old stylesheet id', probe.indexOf('fb-diet-probe-styles') === -1);
  c.ok('manifest loads content.css declaratively', manifest.indexOf('"src/content/content.css"') !== -1);

  // Feed folding styles contracts
  c.ok('content.css defines 8px gap for standard folded bar', css.includes('margin: 0 0 8px 0 !important;'));
  c.ok('content.css defines 4px gap for mini folded bar', css.includes('margin: 0 0 4px 0 !important;'));
  c.ok('content.css defines 8px rounded corners for folded bar', css.includes('border-radius: 8px !important;'));
  c.ok('content.css disables outer frame border when expanded',
    (css.includes('.fb-diet-placeholder.fb-diet-state-expanded ~ .fb-diet-expand-body::after') ||
     css.includes('.fb-diet-placeholder.fb-diet-state-expanded~.fb-diet-expand-body::after')) &&
    css.includes('display: none !important;')
  );
  c.ok('content.css defines .fb-diet-title-group-name', css.includes('.fb-diet-title-group-name'));
  c.ok('content.css defines non-bold for group title', css.includes('.fb-diet-title-group') && css.includes('font-weight: normal !important;'));
}

module.exports = { run };
