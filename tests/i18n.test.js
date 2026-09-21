'use strict';
const { Checker, createWindow, ROOT } = require('./harness');
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
  c.equals('zh-TW options title', i18n.t('optionsTitle'), 'FB Feed Diet 設定');
  c.equals('zh-TW mode title', i18n.t('modeProxyTitle'), '代理模式');
  c.equals('en mode title via lang arg', i18n.t('modeProxyTitle', 'en'), 'Proxy Mode');
  c.equals('explicit en overrides current zh', i18n.getLang(), 'zh-TW', 'after lang-arg read lang is unchanged');

  /* --- locale normalization --- */
  c.equals('zh-CN maps to zh-TW', i18n.normalize('zh-CN'), 'zh-TW');
  c.equals('zh_TW underscore maps to hyphen', i18n.normalize('zh_TW'), 'zh-TW');
  c.equals('null code maps to en', i18n.normalize(null), 'en');

  /* --- fallbacks --- */
  c.equals('unknown key returns the key itself', i18n.t('no.such.key', 'zh-TW'), 'no.such.key');

  /* --- setLang round-trip --- */
  i18n.setLang('en');
  c.equals('setLang switches current language', i18n.getLang(), 'en');
  c.equals('en text after switch', i18n.t('masterStatusActive'), 'Active');
  i18n.setLang('zh-TW');
  c.equals('back to zh-TW', i18n.t('masterStatusDisabled'), '已停用');

  /* --- options + popup keys exist in both locales --- */
  const pageKeys = ['optionsTitle', 'optionsSubtitle', 'masterStatusActive', 'masterStatusDisabled', 'itemsFoldedOnDiet', 'reset', 'sectionEngineMode', 'modeProxyTitle', 'modeProxyDesc', 'sectionDietOptions', 'featSponsoredTitle', 'langToggleTitle', 'popupSubtitle', 'optionsBtn'];
  c.ok('all page keys resolve in en', pageKeys.every((k) => i18n.t(k, 'en') !== k));
  c.ok('all page keys resolve in zh-TW', pageKeys.every((k) => i18n.t(k, 'zh-TW') !== k && i18n.t(k, 'zh-TW') !== i18n.t(k, 'en')));

  /* --- feed-only keys were trimmed from the shared module --- */
  c.equals('feed badge keys removed', i18n.t('badgeSponsored', 'zh-TW'), 'badgeSponsored');
  c.equals('probe unknown badge key replaced by labelRegular', i18n.t('probeCategoryUnknown', 'zh-TW'), 'probeCategoryUnknown');
}

module.exports = { run };