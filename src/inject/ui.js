/**
 * FB Diet - UI and Placeholder Components (MAIN world)
 *
 * Provides React placeholder bars, DOM text and metadata extractors, and group badges.
 *
 * Public API: window.FBDietUI
 */
window.FBDietUI = (() => {
  'use strict';

  const DEFAULTS = globalThis.FB_DIET_DEFAULTS || {};

  const GROUP_BY_CATEGORY = DEFAULTS.GROUP_BY_CATEGORY || {
    sponsored: 'ads',
    marketAds: 'ads',
    searchingAds: 'ads',
    regular: 'regular',
    suggested: 'suggested',
    reels: 'media',
    stories: 'media',
    suggestedGroup: 'other'
  };

  const GROUP_META = DEFAULTS.GROUP_META || {
    ads: {
      badgeClass: 'fb-diet-badge-ads',
      badgeText: 'Ads'
    },
    regular: {
      badgeClass: 'fb-diet-badge-regular',
      badgeText: 'Regular'
    },
    suggested: {
      badgeClass: 'fb-diet-badge-suggested',
      badgeText: 'Suggested'
    },
    media: {
      badgeClass: 'fb-diet-badge-media',
      badgeText: 'Reels & Stories'
    },
    other: {
      badgeClass: 'fb-diet-badge-other',
      badgeText: 'Other'
    }
  };

  function groupOf(category) {
    return GROUP_BY_CATEGORY[category] || 'regular';
  }

  function createEl(type, props, children) {
    const React = window.FBDietProxy ? window.FBDietProxy.getReact() : null;
    const proxy = window.FBDietProxy;
    if (!React || !type) return null;
    return proxy.createElement(React, type, props, children);
  }

  /**
   * The collapsed notice bar (entire strip is clickable).
   */
  function FBDietBar(props) {
    const meta = GROUP_META[groupOf(props.category)] || GROUP_META.other;

    const left = createEl('div', { className: 'fb-diet-placeholder-left' }, [
      createEl('span', { className: 'fb-diet-badge ' + meta.badgeClass }, [meta.badgeText])
    ]);

    return createEl(
      'div',
      {
        className: 'fb-diet-placeholder',
        title: 'Show post',
        onClick: props.onToggle
      },
      [left]
    );
  }

  const titleBarCache = new Map();

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

  function extractFullDomSnapshot(container, isMediaGroup) {
    if (!container || typeof container.querySelector !== 'function') return null;
    try {
      const actor = extractAuthorFromDom(container);
      const snippet = extractMessageFromDom(container);
      const group = extractGroupFromDom(container);
      const postUrl = extractPostUrlFromDom(container);
      const adUrl = extractAdUrlFromDom(container);
      const media = extractMediaFromDom(container, isMediaGroup);
      return { actor, snippet, group, postUrl, adUrl, media };
    } catch (e) {
      return null;
    }
  }

  /**
   * Title mode bar (24px single line snippet, permanent across expand/collapse).
   */
  function FBDietTitleBar(props) {
    const meta = GROUP_META[groupOf(props.category)] || GROUP_META.other;
    const isExpanded = Boolean(props.isExpanded);

    const React = window.FBDietProxy ? window.FBDietProxy.getReact() : null;
    const barRef = React && typeof React.useRef === 'function' ? React.useRef(null) : { current: null };

    const unitId = props.unitId;
    const cached = unitId ? titleBarCache.get(unitId) : null;
    const [domData, setDomData] = (React && typeof React.useState === 'function')
      ? React.useState(cached || null)
      : [cached || null, () => {}];

    const enrichment = props.enrichment || null;
    const initialActor = (enrichment && enrichment.actor && enrichment.actor.name) || (domData && domData.actorName) || '';
    const initialMsg = (enrichment && enrichment.content && (enrichment.content.message || enrichment.content.title)) || (domData && domData.snippetText) || '';
    const initialGroup = (enrichment && enrichment.group && enrichment.group.name) || (domData && domData.groupName) || '';

    if (React && typeof React.useEffect === 'function') {
      React.useEffect(() => {
        if (initialActor && initialMsg) return;
        const el = barRef && barRef.current;
        if (!el) return;
        const container = el.nextElementSibling || (el.parentElement ? el.parentElement.querySelector('.fb-diet-fold-hidden, .fb-diet-expand-body') : null);
        if (!container) return;

        const foundActor = initialActor || extractAuthorFromDom(container);
        const foundMsg = initialMsg || extractMessageFromDom(container);
        const foundGroup = initialGroup || extractGroupFromDom(container);
        const foundAdUrl = extractAdUrlFromDom(container);
        const isMediaGroup = props.category === 'reels' || props.category === 'stories';
        const foundMedia = (!foundMsg && extractMediaFromDom(container, isMediaGroup)) || '';

        if (foundActor || foundMsg || foundGroup || foundMedia || foundAdUrl) {
          const newData = {
            actorName: foundActor || '',
            snippetText: foundMsg || foundMedia || '',
            groupName: foundGroup || '',
            adUrl: foundAdUrl || ''
          };
          if (unitId) titleBarCache.set(unitId, newData);
          setDomData(newData);
        }
      }, [initialActor, initialMsg, initialGroup, unitId, props.category]);
    }

    const effectiveActor = (domData && domData.actorName) || initialActor;
    const effectiveMsg = (domData && domData.snippetText) || initialMsg;
    const effectiveGroup = (domData && domData.groupName) || initialGroup;

    const badge = createEl('span', { className: 'fb-diet-badge ' + meta.badgeClass }, [meta.badgeText]);
    const contentKids = [badge];

    // Group name (with max-width: 140px in css)
    if (effectiveGroup) {
      contentKids.push(
        createEl('span', { className: 'fb-diet-title-group', title: effectiveGroup }, ['[' + effectiveGroup + ']'])
      );
    }

    // Author string & reshare detection
    let authorText = '';
    if (effectiveActor) {
      authorText = effectiveActor + ':';
    } else if (props.category === 'stories') {
      authorText = '限時動態';
    } else if (props.category === 'reels') {
      authorText = '連續短片';
    } else if (props.category === 'suggestedGroup') {
      authorText = '推薦社團:';
    }

    if (authorText) {
      contentKids.push(
        createEl('span', { className: 'fb-diet-title-author', title: authorText }, [authorText])
      );
    }

    // Message snippet / title / media fallback
    let snippetText = effectiveMsg;
    if (!snippetText) {
      const media = enrichment && enrichment.media;
      const isMediaCategory = props.category === 'reels' || props.category === 'stories';
      if (media && media.hasVideo) {
        snippetText = '🎬 [影片]';
      } else if (!isMediaCategory && media && (media.count > 0 || media.isMultiImage)) {
        snippetText = media.isMultiImage ? '📷 [多張相片]' : '📷 [相片]';
      } else if (enrichment && enrichment.content && enrichment.content.callToAction) {
        snippetText = '👉 [' + enrichment.content.callToAction + ']';
      }
    }

    if (snippetText) {
      contentKids.push(
        createEl('span', { className: 'fb-diet-title-snippet', title: snippetText }, [snippetText])
      );
    }

    const contentBox = createEl('div', { className: 'fb-diet-title-content' }, contentKids);

    return createEl(
      'div',
      {
        ref: barRef,
        className: 'fb-diet-titlebar' + (isExpanded ? ' fb-diet-state-expanded' : ''),
        title: isExpanded ? 'Re-fold' : 'Show post',
        onClick: props.onToggle
      },
      [contentBox]
    );
  }

  return {
    GROUP_BY_CATEGORY,
    GROUP_META,
    groupOf,
    createEl,
    titleBarCache,
    extractAuthorFromDom,
    extractMessageFromDom,
    extractGroupFromDom,
    extractAdUrlFromDom,
    extractPostUrlFromDom,
    extractMediaFromDom,
    extractFullDomSnapshot,
    FBDietBar,
    FBDietTitleBar
  };
})();
