'use strict';
/**
 * Tests for src/content/fallback.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT } = require('./harness');

function run(checker) {
  const defaultsCode = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'defaults.js'), 'utf8');
  const fallbackCode = fs.readFileSync(path.join(ROOT, 'src', 'content', 'fallback.js'), 'utf8');

  class FakeClassList {
    constructor() {
      this.classes = new Set();
    }
    add(...cls) {
      cls.forEach((c) => this.classes.add(c));
    }
    remove(...cls) {
      cls.forEach((c) => this.classes.delete(c));
    }
    contains(c) {
      return this.classes.has(c);
    }
  }

  class FakeElement {
    constructor(tagName) {
      this.tagName = (tagName || 'div').toUpperCase();
      this.classList = new FakeClassList();
      this.className = '';
      this.children = [];
      this.parentElement = null;
      this.dataset = {};
      this.attributes = {};
      this.listeners = {};
      this.isConnected = true;
      this.textContent = '';
    }
    setAttribute(k, v) {
      this.attributes[k] = v;
    }
    getAttribute(k) {
      return this.attributes[k] || null;
    }
    appendChild(child) {
      this.children.push(child);
      child.parentElement = this;
      return child;
    }
    insertBefore(newChild, refChild) {
      const idx = this.children.indexOf(refChild);
      if (idx !== -1) {
        this.children.splice(idx, 0, newChild);
      } else {
        this.children.push(newChild);
      }
      newChild.parentElement = this;
      return newChild;
    }
    remove() {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        if (idx !== -1) this.parentElement.children.splice(idx, 1);
        this.parentElement = null;
      }
    }
    addEventListener(type, fn) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(fn);
    }
    click() {
      const handlers = this.listeners['click'] || [];
      handlers.forEach((fn) => fn({ stopPropagation() {}, preventDefault() {} }));
    }
    querySelectorAll(selector) {
      return [];
    }
    querySelector(selector) {
      return null;
    }
    closest(selector) {
      return this.parentElement;
    }
  }

  class FakeDocument {
    constructor() {
      this.body = new FakeElement('body');
    }
    createElement(tag) {
      return new FakeElement(tag);
    }
    querySelectorAll(selector) {
      return [];
    }
    querySelector(selector) {
      return null;
    }
  }

  const doc = new FakeDocument();
  const sandbox = {
    globalThis: {},
    document: doc,
    window: {},
    requestAnimationFrame: (cb) => cb(),
    MutationObserver: class {
      constructor(cb) { this.cb = cb; }
      observe() {}
      disconnect() {}
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(defaultsCode, sandbox);
  vm.runInContext(fallbackCode, sandbox);

  const fallback = sandbox.window.FBDietDOMFallback;
  checker.ok('FBDietDOMFallback is exposed on window', Boolean(fallback));

  // Placeholder creation
  const original = new FakeElement('div');
  const placeholder = fallback.createPlaceholder('sponsored', original);
  checker.ok('placeholder created', Boolean(placeholder));
  checker.equals('placeholder class is fb-diet-placeholder', placeholder.className, 'fb-diet-placeholder');
  checker.equals('placeholder attribute data-fb-diet-type is sponsored', placeholder.getAttribute('data-fb-diet-type'), 'sponsored');
  checker.equals('placeholder has left container', placeholder.children.length, 1);

  const left = placeholder.children[0];
  checker.equals('left container has badge', left.children.length, 1);
  const badge = left.children[0];
  checker.equals('badge text is Ads', badge.textContent, 'Ads');
  checker.ok('badge class contains fb-diet-badge-ads', badge.className.indexOf('fb-diet-badge-ads') !== -1);

  // Click to expand / re-fold
  placeholder.click();
  checker.ok('original element marked expanded on click', original.classList.contains('fb-diet-is-expanded'));
  checker.ok('placeholder marked expanded on click', placeholder.classList.contains('fb-diet-state-expanded'));

  placeholder.click();
  checker.ok('original element unmarked on second click', !original.classList.contains('fb-diet-is-expanded'));
  checker.ok('placeholder unmarked on second click', !placeholder.classList.contains('fb-diet-state-expanded'));

  // foldElement
  const parent = new FakeElement('div');
  const feedPost = new FakeElement('div');
  parent.appendChild(feedPost);

  let blockedCategory = null;
  fallback.foldElement(feedPost, 'sponsored', (cat) => { blockedCategory = cat; });
  checker.equals('onBlocked callback received sponsored', blockedCategory, 'sponsored');
  checker.equals('feedPost dataset marked folded', feedPost.dataset.fbDietFolded, 'true');
  checker.ok('parent now contains placeholder before feedPost', parent.children[0].className === 'fb-diet-placeholder');

  // restoreAllElements
  let removedPlaceholder = false;
  let restoredOriginal = false;
  doc.querySelectorAll = (selector) => {
    if (selector === '.fb-diet-placeholder') {
      return [{ remove() { removedPlaceholder = true; } }];
    }
    if (selector === '.fb-diet-folded-original') {
      return [{
        classList: new FakeClassList(),
        dataset: { fbDietFolded: 'true', fbDietChecked: 'true' }
      }];
    }
    return [];
  };
  fallback.restoreAllElements();
  checker.ok('restoreAllElements removes placeholders', removedPlaceholder);

  // evaluateElement with settings
  sandbox.window.FBDietDetector = {
    isSponsored: (el) => el.dataset.isSpo === 'true'
  };
  const spoEl = new FakeElement('div');
  spoEl.dataset.isSpo = 'true';
  parent.appendChild(spoEl);

  let evalBlocked = null;
  fallback.evaluateElement(spoEl, { enabled: true, foldSponsored: true }, (cat) => { evalBlocked = cat; });
  checker.equals('evaluateElement folds matching sponsored element', evalBlocked, 'sponsored');

  /* --- fold scope: leaving the allowlist restores once, re-entering rescans (decision #26) --- */
  {
    const calls = { restore: 0, fingerprint: 0, scan: 0 };
    const staleEl = { dataset: { fbDietFingerprint: 'stale-fp' }, classList: new FakeClassList() };
    doc.querySelectorAll = (selector) => {
      if (selector === '.fb-diet-placeholder') {
        calls.restore += 1;
        return [{ remove() {} }];
      }
      if (selector === '.fb-diet-folded-original') return [staleEl];
      if (selector === '[data-fb-diet-fingerprint]') {
        calls.fingerprint += 1;
        return [staleEl];
      }
      calls.scan += 1;
      return [];
    };

    const settings = { enabled: true, restrictFoldScope: true };

    // In scope: the full scan runs, nothing is restored.
    sandbox.location = { pathname: '/' };
    fallback.scanPage(settings, () => {});
    checker.equals('in-scope scan runs the selector pass', calls.scan, 1);
    checker.equals('in-scope scan restores nothing', calls.restore, 0);

    // Leave the allowlist: restore fires exactly once and clears stale fingerprints.
    sandbox.location = { pathname: '/groups/feed' };
    fallback.scanPage(settings, () => {});
    checker.equals('leaving the scope restores folded elements once', calls.restore, 1);
    checker.equals('leaving the scope queries fingerprints once', calls.fingerprint, 1);
    checker.equals('stale fingerprint deleted for recycled nodes', staleEl.dataset.fbDietFingerprint, undefined);
    checker.equals('out-of-scope scan skips the selector pass', calls.scan, 1);

    // Still out of scope: only the pathname comparison runs (no restore, no scan).
    fallback.scanPage(settings, () => {});
    checker.equals('staying out of scope does not restore again', calls.restore, 1);
    checker.equals('staying out of scope does not rescan', calls.scan, 1);

    // Back in scope: the scan resumes so restored units can re-fold.
    sandbox.location = { pathname: '/' };
    fallback.scanPage(settings, () => {});
    checker.equals('re-entering the scope rescans', calls.scan, 2);
    checker.equals('re-entering the scope restores nothing', calls.restore, 1);

    // Toggle off: out-of-scope paths scan anyway.
    sandbox.location = { pathname: '/groups/feed' };
    fallback.scanPage({ enabled: true, restrictFoldScope: false }, () => {});
    checker.equals('restrictFoldScope:false scans out of scope', calls.scan, 3);
  }
}

module.exports = { run };
