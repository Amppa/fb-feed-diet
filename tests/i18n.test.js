'use strict';
const { Checker, createWindow, loadDefaults, ROOT } = require('./harness');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadI18n(win, navigatorLang) {
  const code = fs.readFileSync(path.join(ROOT, 'src', 'i18n', 'i18n.js'), 'utf8');
  const sandbox = { window: win, console, navigator: { language: navigatorLang } };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'src/i18n/i18n.js' });
  return win.FBDietI18N;
}

/**
 * A document double for `applyTo`: elements carry a `dataset` plus writable text/title/
 * placeholder and a recording `setAttribute`, which is exactly the surface the four walks touch.
 * `tests/harness.js` makeNode is deliberately not used here — it models a rendered DOM node
 * (attributes in, text out) and has no `dataset` or `setAttribute`, so it cannot express
 * "this module wrote into the page".
 */
function makeI18nDoc(elementsBySelector) {
  return {
    documentElement: { lang: '' },
    querySelectorAll(selector) {
      return elementsBySelector[selector] || [];
    }
  };
}

function makeI18nEl(dataset) {
  return {
    dataset,
    textContent: '',
    title: '',
    placeholder: '',
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    }
  };
}

function run(c) {
  const win = createWindow();

  const i18n = loadI18n(win, 'zh-TW');
  c.ok('i18n API exposed on window', Boolean(i18n) && typeof i18n.t === 'function');

  /* --- default language detection --- */
  c.equals('detect honors navigator zh-TW', i18n.detect(), 'zh-TW');
  c.equals('current lang is detected at load', i18n.getLang(), 'zh-TW');

  const i18nEn = loadI18n(createWindow(), 'en-US');
  c.equals('en-US normalizes to en', i18nEn.getLang(), 'en');

  const i18nFallback = loadI18n(createWindow(), 'fr-FR');
  c.equals('unsupported locale falls back to en', i18nFallback.getLang(), 'en');

  /* --- translation lookups --- */
  c.equals('zh-TW options title', i18n.t('optionsTitle'), 'Feed Diet 設定');
  c.equals('zh-TW detection source title', i18n.t('featDetectionTitle'), '貼文分類器 讀取來源');
  c.equals('en detection source title via lang arg', i18n.t('featDetectionTitle', 'en'), 'Detection Source');
  c.equals('explicit en overrides current zh', i18n.getLang(), 'zh-TW', 'after lang-arg read lang is unchanged');

  /* --- locale normalization --- */
  c.equals('zh-CN maps to zh-TW', i18n.normalize('zh-CN'), 'zh-TW');
  c.equals('zh_TW underscore maps to hyphen', i18n.normalize('zh_TW'), 'zh-TW');
  c.equals('null code maps to en', i18n.normalize(null), 'en');

  /* --- the feed's copy of this rule must not drift away from it --- */
  //
  // src/shared/defaults.js owns the normaliser the injected feed renders with, and it is a
  // second implementation on purpose: this module has to stay usable without that file, and the
  // feed must not have to fetch a dictionary it mostly never reads. Nothing but this assertion
  // stops the two rules diverging, so it covers every shape of input either one can see.
  const sharedDefaults = loadDefaults();
  const localeInputs = ['zh-TW', 'zh-CN', 'zh_CN', 'zh-Hant-TW', 'ZH', 'zh', 'en-US', 'EN', 'fr-FR', 'JA', '', null, undefined, 0];
  const disagreed = localeInputs.filter(
    (code) => i18n.normalize(code) !== sharedDefaults.normalizeLocale(code)
  );
  c.equals('the shared locale rule mirrors this one on every input', disagreed.join(', '), '');

  /* --- fallbacks --- */
  c.equals('unknown key returns the key itself', i18n.t('no.such.key', 'zh-TW'), 'no.such.key');

  /* --- setLang round-trip --- */
  i18n.setLang('en');
  c.equals('setLang switches current language', i18n.getLang(), 'en');
  c.equals('en text after switch', i18n.t('masterStatusActive'), 'Active');
  i18n.setLang('zh-TW');
  c.equals('back to zh-TW', i18n.t('masterStatusDisabled'), '已停用');

  /* --- options + popup keys exist in both locales --- */
  const pageKeys = ['optionsTitle', 'optionsSubtitle', 'masterStatusActive', 'masterStatusDisabled', 'itemsFoldedOnDiet', 'reset', 'featDetectionTitle', 'featDetectionDesc', 'featDetectionRelay', 'sectionDietOptions', 'groupAdsTitle', 'groupAdsDesc', 'groupRegularTitle', 'groupRegularDesc', 'groupSuggestedTitle', 'groupSuggestedDesc', 'groupMediaTitle', 'groupMediaDesc', 'groupOtherTitle', 'groupOtherDesc', 'sectionFoldAppearance', 'featMinimizedFoldTitle', 'featAlwaysShowBarTitle', 'featAlwaysShowBarDesc', 'featTitleModeTitle', 'featTitleModeDesc', 'featTitleModeAlways', 'featTitleModeWhenFolded', 'featTitleModeNever', 'featFoldScopeTitle', 'featFoldScopeDesc', 'featProbeTitle', 'resetAppearanceBtn', 'resetAppearanceDesc', 'projectUrlLabel', 'langToggleTitle', 'popupSubtitle', 'optionsBtn', 'resetPopupTitle', 'statusNeedsReload', 'statusHookBlocked'];
  c.ok('all page keys resolve in en', pageKeys.every((k) => i18n.t(k, 'en') !== k));
  c.ok('all page keys resolve in zh-TW', pageKeys.every((k) => i18n.t(k, 'zh-TW') !== k));

  /* --- the two dictionaries cover exactly the same keys --- */
  //
  // Key-set equality, not string equality. `t()` falls back to English for a key the target
  // locale does not define, so a zh-TW entry that was never written resolves to the English
  // text and passes both checks above; comparing the key sets is what catches it.
  //
  // It cannot be a string comparison either. A product term is legitimately identical in both
  // locales — the mode names are a compatibility contract (STRATEGY.md #38) — so a rule of
  // "zh-TW must differ from en" reports a correctly translated label as an untranslated one,
  // and every such label costs another entry in an allowlist that only ever grows. Comparing
  // the keys instead means the rule has no exceptions to maintain.
  const enKeys = Object.keys(i18n.LOCALES.en).sort();
  const zhKeys = Object.keys(i18n.LOCALES['zh-TW']).sort();
  const enOnly = enKeys.filter((key) => zhKeys.indexOf(key) === -1);
  const zhOnly = zhKeys.filter((key) => enKeys.indexOf(key) === -1);
  c.equals(
    'both dictionaries define the same keys',
    'en-only: [' + enOnly.join(', ') + '] zh-only: [' + zhOnly.join(', ') + ']',
    'en-only: [] zh-only: []'
  );

  /* --- the key count is pinned, because the shape cannot report a repeat --- */
  //
  // Each locale is merged from three group objects (COMMON / POPUP / OPTIONS). A key listed in
  // two groups is silently overwritten by the last spread — no test above can see it, because both
  // locales would still agree and the key would still resolve. The count is what notices: a
  // repeat makes it one short. Adding a key means raising this number on purpose.
  c.equals('en key count is what the three groups declare', enKeys.length, 50);
  c.equals('zh-TW key count matches', zhKeys.length, 50);

  /* --- feed-only keys were trimmed from the shared module --- */
  c.equals('feed badge keys removed', i18n.t('badgeSponsored', 'zh-TW'), 'badgeSponsored');
  c.equals('probe unknown badge key replaced by labelRegular', i18n.t('probeCategoryUnknown', 'zh-TW'), 'probeCategoryUnknown');

  /* --- retired fold-mode segment labels stay removed --- */
  const retiredKeys = ['appName', 'modeOff', 'modeTitle', 'modeMini'];
  c.ok(
    'retired fold-mode keys resolve to their own name',
    retiredKeys.every((key) => i18n.t(key, 'en') === key && i18n.t(key, 'zh-TW') === key)
  );

  /* --- applyTo(): the one walk both pages call --- */
  //
  // It is the only DOM-aware part of the module, so these cases are about the four attributes it
  // owns, the language it stamps on <html>, and the fact that it survives a document it cannot
  // walk — the module is loaded in a sandbox with no document at all, so the guard is load-bearing.
  {
    const title = makeI18nEl({ i18n: 'optionsSubtitle' });
    const ariaTitle = makeI18nEl({ i18nTitle: 'langToggleTitle' });
    const placeholder = makeI18nEl({ i18nPlaceholder: 'resetOptionsTitle' });
    const toggle = makeI18nEl({ i18n: 'masterToggleTitle', i18nAria: 'masterToggleTitle' });
    const doc = makeI18nDoc({
      '[data-i18n]': [title, toggle],
      '[data-i18n-title]': [ariaTitle],
      '[data-i18n-placeholder]': [placeholder],
      '[data-i18n-aria]': [toggle]
    });

    i18n.applyTo(doc);

    c.equals('applyTo writes textContent', title.textContent, '臉書減肥: 對廣告與推薦內容縮短顯示');
    c.equals('applyTo writes title', ariaTitle.title, '切換語言');
    c.equals('applyTo writes placeholder', placeholder.placeholder, '重設所有計數統計');
    c.equals('applyTo writes aria-label', toggle.attrs['aria-label'], '總開關');
    c.equals('applyTo also translates textContent on an aria element', toggle.textContent, '總開關');
    c.equals('applyTo stamps documentElement.lang', doc.documentElement.lang, 'zh-TW');

    // The two walks are independent, so one element carrying both attributes gets both written.
    c.equals(
      'one element can take both a text and an aria-label write',
      [toggle.textContent, toggle.attrs['aria-label']].join(' | '),
      '總開關 | 總開關'
    );

    i18n.setLang('en');
    i18n.applyTo(doc);
    c.equals('applyTo follows a language switch', ariaTitle.title, 'Switch language');
    c.equals('…including the aria-label', toggle.attrs['aria-label'], 'Master Toggle');
    c.equals('…and the lang attribute', doc.documentElement.lang, 'en');
    i18n.setLang('zh-TW');

    c.ok('applyTo survives no argument', (() => { i18n.applyTo(); return true; })());
    c.ok('applyTo survives a document without querySelectorAll', (() => { i18n.applyTo({}); return true; })());
    c.ok(
      'applyTo survives a throwing document instead of propagating',
      (() => {
        i18n.applyTo({
          documentElement: {},
          querySelectorAll() { throw new Error('detached'); }
        });
        return true;
      })()
    );
  }

  /* --- every dictionary key needs a consumer in src/ (no dead entries) --- */
  function sourceFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...sourceFiles(full));
      else out.push(full);
    }
    return out;
  }

  const consumers = sourceFiles(path.join(ROOT, 'src'))
    .filter((file) => path.basename(file) !== 'i18n.js')
    .map((file) => fs.readFileSync(file, 'utf8'));
  const unusedKeys = Object.keys(i18n.LOCALES.en)
    .filter((key) => consumers.every((text) => text.indexOf(key) === -1));
  c.equals('no unused keys in the shared dictionary', unusedKeys.join(','), '');
}

module.exports = { run };