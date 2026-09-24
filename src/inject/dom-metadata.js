/**
 * FB Diet - DOM metadata collector (MAIN world)
 *
 * Extracts best-effort author, message, group, URL and media fields from a
 * mounted Facebook feed-unit container. This is intentionally separate from
 * metadata.js, which enriches diagnostics from props and Relay records.
 */
window.FBDietDOMMetadata = (() => {
  'use strict';

  function extractAuthorFromDom(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return null;
    try {
      const headings = container.querySelectorAll('h2, h3, h4, h5, [role="heading"]');
      for (const h of headings) {
        const link = h.querySelector('a[role="link"], a[href]');
        const text = (link || h).textContent.trim();
        if (text && text.length > 1 && text.length < 80) return text;
      }
      const strongLink = container.querySelector('a[role="link"] strong, strong a[role="link"]');
      if (strongLink) {
        const text = strongLink.textContent.trim();
        if (text && text.length > 1 && text.length < 80) return text;
      }
      const headerLink = container.querySelector('header a[role="link"], [data-ad-comet-preview="header"] a');
      if (headerLink) {
        const text = headerLink.textContent.trim();
        if (text && text.length > 1 && text.length < 80) return text;
      }
    } catch (e) {}
    return null;
  }

  function extractMessageFromDom(container) {
    if (!container || typeof container.querySelector !== 'function') return null;
    try {
      const msgEl = container.querySelector('[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-testid="post_message"]');
      if (msgEl) {
        const text = msgEl.textContent.trim();
        if (text) return text.split('\n')[0].trim();
      }
      const dirEls = container.querySelectorAll('div[dir="auto"]');
      for (const el of dirEls) {
        if (el.closest && el.closest('h2, h3, h4, h5, [role="heading"], header')) continue;
        const text = el.textContent.trim();
        if (text && text.length > 2) {
          return text.split('\n')[0].trim();
        }
      }
    } catch (e) {}
    return null;
  }

  function extractGroupFromDom(container) {
    if (!container || typeof container.querySelector !== 'function') return null;
    try {
      const groupLink = container.querySelector('a[href*="/groups/"]');
      if (groupLink) {
        const text = groupLink.textContent.trim();
        if (text && text.length > 1 && text.length < 80) return text;
      }
    } catch (e) {}
    return null;
  }

  function extractAdUrlFromDom(container) {
    if (!container || typeof container.querySelector !== 'function') return null;
    try {
      const adLink = container.querySelector('a[href*="/ads/about/"]');
      if (adLink && adLink.href) return adLink.href;
    } catch (e) {}
    return null;
  }

  function extractPostUrlFromDom(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return null;
    try {
      const links = container.querySelectorAll('a[role="link"], a[href]');
      for (const a of links) {
        const href = a.href || a.getAttribute('href') || '';
        if (
          href.indexOf('/posts/') !== -1 ||
          href.indexOf('permalink.php') !== -1 ||
          href.indexOf('/videos/') !== -1 ||
          href.indexOf('/photos/') !== -1 ||
          href.indexOf('story_fbid=') !== -1
        ) {
          return href.startsWith('/') ? 'https://www.facebook.com' + href : href;
        }
      }
    } catch (e) {}
    return null;
  }

  function extractMediaFromDom(container, isMediaGroup) {
    if (!container || typeof container.querySelector !== 'function') return null;
    try {
      if (container.querySelector('video, [data-video-id]')) return '🎬 [影片]';
      if (!isMediaGroup) {
        const imgs = container.querySelectorAll('img[src*="fbcdn"]');
        if (imgs.length > 1) return '📷 [多張相片]';
        if (imgs.length === 1) return '📷 [相片]';
      }
    } catch (e) {}
    return null;
  }

  function collect(container, isMediaGroup) {
    if (!container || typeof container.querySelector !== 'function') return null;
    try {
      return {
        actor: extractAuthorFromDom(container),
        snippet: extractMessageFromDom(container),
        group: extractGroupFromDom(container),
        postUrl: extractPostUrlFromDom(container),
        adUrl: extractAdUrlFromDom(container),
        media: extractMediaFromDom(container, isMediaGroup)
      };
    } catch (e) {
      return null;
    }
  }

  return { collect };
})();
