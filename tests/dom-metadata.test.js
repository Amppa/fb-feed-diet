'use strict';
/** Contract tests for the MAIN-world DOM metadata collector. */
const { createWindow, loadInject } = require('./harness');

function makeNode(tag, attrs = {}, children = [], text = '') {
  const node = {
    tagName: tag.toUpperCase(),
    attributes: Object.assign({}, attrs),
    href: attrs.href,
    children: [],
    parentElement: null,
    textContent: text,
    getAttribute(name) { return this.attributes[name] === undefined ? null : this.attributes[name]; },
    matches(selector) {
      const parts = selector.match(/^([a-zA-Z0-9-]+)?(\[[^\]]+\])$/);
      if (parts) {
        if (parts[1] && parts[1].toUpperCase() !== this.tagName) return false;
        const attrMatch = parts[2].match(/^\[([^\]=*]+)(?:\*?=)?(.*)\]$/);
        if (attrMatch) {
          const name = attrMatch[1];
          const value = attrMatch[2] === undefined ? null : attrMatch[2].replace(/^["']|["']$/g, '');
          if (value === null) return this.attributes[name] !== undefined;
          return this.attributes[name] && this.attributes[name].indexOf(value) !== -1;
        }
      }
      return selector.toUpperCase() === this.tagName;
    },
    closest(selector) {
      let current = this;
      while (current) {
        if (current.matches(selector)) return current;
        current = current.parentElement;
      }
      return null;
    },
    contains(other) {
      let current = other;
      while (current) {
        if (current === this) return true;
        current = current.parentElement;
      }
      return false;
    },
    querySelectorAll(selector) {
      const selectors = selector.split(',').map((part) => part.trim());
      const result = [];
      const walk = (parent) => {
        for (const child of parent.children) {
          if (selectors.some((part) => child.matches(part)) && result.indexOf(child) === -1) result.push(child);
          walk(child);
        }
      };
      walk(this);
      return result;
    },
    querySelector(selector) {
      const result = this.querySelectorAll(selector);
      return result.length ? result[0] : null;
    }
  };
  for (const child of children) {
    if (child) {
      child.parentElement = node;
      node.children.push(child);
    }
  }
  if (!text && node.children.length) node.textContent = node.children.map((child) => child.textContent).join(' ');
  return node;
}

function run(c) {
  const win = createWindow();
  loadInject(win, 'dom-metadata.js');
  const metadata = win.FBDietDOMMetadata;

  c.ok('DOM metadata API is exposed', Boolean(metadata) && typeof metadata.collect === 'function');
  c.equals('null container returns null', metadata.collect(null), null);
  c.equals('object without querySelector returns null', metadata.collect({}), null);

  const author = makeNode('a', { role: 'link' }, [], 'Ada Lovelace');
  const heading = makeNode('h3', { role: 'heading' }, [author]);
  const group = makeNode('a', { href: '/groups/engineering' }, [], 'Engineering Group');
  const post = makeNode('a', { href: '/posts/123' }, [], 'permalink');
  const ad = makeNode('a', { href: '/ads/about/ad-1' }, [], 'ad details');
  const message = makeNode('div', { 'data-ad-preview': 'message' }, [], 'First line\nSecond line');
  const image = makeNode('img', { src: 'https://fbcdn.example/photo.jpg' });
  const card = makeNode('article', {}, [heading, group, post, ad, message, image]);

  const snapshot = metadata.collect(card, false);
  c.equals('collector returns actor', snapshot && snapshot.actor, 'Ada Lovelace');
  c.equals('collector returns first message line', snapshot && snapshot.snippet, 'First line');
  c.equals('collector returns group', snapshot && snapshot.group, 'Engineering Group');
  c.equals('collector returns post URL', snapshot && snapshot.postUrl, 'https://www.facebook.com/posts/123');
  c.equals('collector returns ad URL', snapshot && snapshot.adUrl, '/ads/about/ad-1');
  c.equals('collector returns single image label', snapshot && snapshot.media, '📷 [相片]');

  const videoCard = makeNode('article', {}, [makeNode('video')]);
  c.equals('collector returns video label', metadata.collect(videoCard, false).media, '🎬 [影片]');
  c.equals('media groups suppress photo labels', metadata.collect(card, true).media, null);

  // Suggested post with section heading "為你推薦" before author heading
  const recHeading = makeNode('h3', {}, [], '為你推薦');
  const realAuthorLink = makeNode('a', { role: 'link' }, [], 'Grace Hopper');
  const authorHeading = makeNode('h4', { role: 'heading' }, [realAuthorLink]);
  const followLink = makeNode('a', { role: 'link' }, [], '追蹤');
  const timeSpan = makeNode('span', { dir: 'auto' }, [], '12 小時');
  const postMsgSpan = makeNode('span', { dir: 'auto' }, [], 'Compilers are amazing\nSecond line');
  const suggestedCard = makeNode('article', {}, [recHeading, authorHeading, followLink, timeSpan, postMsgSpan]);

  const suggestedSnapshot = metadata.collect(suggestedCard, false);
  c.equals('skips 為你推薦 and extracts real author', suggestedSnapshot && suggestedSnapshot.actor, 'Grace Hopper');
  c.equals('skips timestamp and extracts post message from span[dir=auto]', suggestedSnapshot && suggestedSnapshot.snippet, 'Compilers are amazing');
}

module.exports = { run };
