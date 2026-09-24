'use strict';
/** Contract test for the project link at the bottom of the options page. */
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./harness');

const PROJECT_URL = 'https://github.com/Amppa/fb-feed-diet';

function run(c) {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'options', 'options.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src', 'options', 'options.css'), 'utf8');
  const link = `<a class="project-link" href="${PROJECT_URL}" target="_blank" rel="noopener noreferrer">${PROJECT_URL}</a>`;
  const appearanceListStart = html.indexOf('id="appearanceList"');
  const footerStart = html.indexOf('    <footer class="feature-desc section-gap project-footer">');
  const scriptsStart = html.indexOf('<script src="../shared/defaults.js"></script>');

  c.equals('options page renders the project URL once', html.split(link).length - 1, 1);
  c.ok('project URL label is localized', html.includes('<span data-i18n="projectUrlLabel">Project URL:</span>'));
  c.ok('project URL appears after all settings sections', footerStart > html.indexOf('id="appearanceList"'));
  c.ok('project URL footer stays outside the disabled settings list', html.indexOf('\n    </div>\n\n    <footer class="feature-desc section-gap project-footer">', appearanceListStart) !== -1);
  c.ok('project URL footer stays above the page scripts', footerStart !== -1 && footerStart < scriptsStart);
  c.ok('Lite mode has no recommendation badge', !html.includes('badge-recommended') && !html.includes('data-i18n="modeRecommended"'));
  c.ok('recommendation badge styles are removed', !css.includes('.badge-recommended'));
}

module.exports = { run };
