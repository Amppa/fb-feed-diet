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
   * Kept for backwards compatibility; delegates to FBDietTitleBar.
   */
  function FBDietBar(props) {
    return FBDietTitleBar(Object.assign({}, props, {
      isMini: props.isMini !== undefined ? props.isMini : true,
      showTitle: false
    }));
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

  const SUGGESTED_TEXT_KEYWORDS = [
    '為你推薦',
    '为你推荐',
    'Suggested for you',
    '推薦貼文',
    '推荐帖子',
    'Suggested post',
    '推薦你加入',
    '推荐你加入',
    'Popular across Facebook',
    'Facebook 熱門內容'
  ];

  const FOLLOW_EXACT_WORDS = ['追蹤', 'follow', '關注', '追蹤粉絲專頁', 'follow page'];
  const JOIN_EXACT_WORDS = ['加入', 'join', '加入社團', 'join group'];
  const NEGATIVE_FOLLOW_WORDS = ['取消追蹤', '已追蹤', 'following', 'unfollow', '已加入', 'joined'];

  const MENU_OR_DISMISS_LABELS = [
    '操作', '動作', '採取的動作', '更多', '貼文選項', 'actions', 'more', 'post options',
    '關閉', '隱藏', 'hide', 'close', 'dismiss', 'edit or delete'
  ];

  const PRIVACY_OR_TIME_LABELS = [
    '公開', '朋友', '只限本人', '自訂', 'public', 'friends', 'only me', 'custom', 'shared with'
  ];

  function matchFollowOrJoin(str) {
    if (!str || typeof str !== 'string') return null;
    const clean = str.replace(/^[·•\s+]+/, '').trim().toLowerCase();
    if (!clean) return null;
    for (const neg of NEGATIVE_FOLLOW_WORDS) {
      if (clean.indexOf(neg) !== -1) return null;
    }
    for (const target of FOLLOW_EXACT_WORDS) {
      if (clean === target) {
        return { signal: 'Follow', reason: 'dom:follow_button', text: str };
      }
    }
    for (const target of JOIN_EXACT_WORDS) {
      if (clean === target) {
        return { signal: 'Join', reason: 'dom:join_button', text: str };
      }
    }
    return null;
  }

  const VERIFIED_LABELS = [
    '已驗證帳號', '已驗證', 'verified account', 'verified', 'meta verified', '確認身分'
  ];

  function isVerifiedBadge(el) {
    if (!el) return false;
    const aria = (el.getAttribute && el.getAttribute('aria-label') || '').toLowerCase();
    for (const v of VERIFIED_LABELS) {
      if (aria.indexOf(v) !== -1) return true;
    }
    const title = (el.getAttribute && el.getAttribute('title') || '').toLowerCase();
    for (const v of VERIFIED_LABELS) {
      if (title.indexOf(v) !== -1) return true;
    }
    const text = (el.textContent || '').trim().toLowerCase();
    for (const v of VERIFIED_LABELS) {
      if (text.indexOf(v) !== -1) return true;
    }
    if (el.querySelector && el.querySelector('[aria-label*="已驗證"], [aria-label*="Verified"], [title*="已驗證"], [title*="Verified"]')) {
      return true;
    }
    return false;
  }

  function isCardMenuOrPrivacy(el) {
    if (!el) return false;
    if (isVerifiedBadge(el)) return true;
    const aria = (el.getAttribute && el.getAttribute('aria-label') || '').toLowerCase();
    const hasPopup = el.getAttribute && el.getAttribute('aria-haspopup');
    if (hasPopup === 'menu' || hasPopup === 'true') return true;
    for (const label of MENU_OR_DISMISS_LABELS) {
      if (aria.indexOf(label) !== -1) return true;
    }
    for (const label of PRIVACY_OR_TIME_LABELS) {
      if (aria.indexOf(label) !== -1) return true;
    }
    const href = (el.getAttribute && el.getAttribute('href')) || el.href || '';
    if (href && typeof href === 'string' && href.match(/\/(posts|videos|photos|permalink|story_fbid)/)) {
      return true;
    }
    if (el.querySelector && el.querySelector('abbr, time')) {
      return true;
    }
    if (aria.indexOf('大頭貼照') !== -1 || aria.indexOf('個人檔案') !== -1 || aria.indexOf('profile picture') !== -1) {
      return true;
    }
    if (el.querySelector && el.querySelector('image, img[src*="fbcdn"]')) {
      return true;
    }
    return false;
  }

  function isInsideNestedReshare(el, root) {
    if (!el || !root || el === root) return false;
    let cur = el.parentElement;
    while (cur && cur !== root) {
      if (cur.getAttribute && cur.getAttribute('role') === 'article' && cur !== root) {
        return true;
      }
      const preview = cur.getAttribute && cur.getAttribute('data-ad-preview');
      if (preview === 'message_container' || preview === 'attachment') {
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }

  /**
   * DOM-based Suggested post detection for Full Mode.
   * Scopes strictly to author-level headers to prevent false positives on reshared content.
   * Returns: { isSuggested: true, signal: 'Follow' | 'Join' | 'Other', reason: string, text: string, debug: object } | null
   */
  function detectSuggestedFromDom(container) {
    if (!container || typeof container.querySelector !== 'function') return null;
    try {
      const debugLog = {
        primaryAuthor: null,
        buttonsFound: [],
        excludedButtons: []
      };

      // 1. Direct aria-label checks on header elements
      for (const kw of SUGGESTED_TEXT_KEYWORDS) {
        const ariaMatch = container.querySelector(`[aria-label*="${kw}"]`);
        if (ariaMatch && !isInsideNestedReshare(ariaMatch, container)) {
          return {
            isSuggested: true,
            signal: 'Other',
            reason: 'dom:aria_suggested',
            text: kw,
            debug: { matchedAria: kw }
          };
        }
      }

      // 2. Author-Level Header Scoping: locate primary top-level heading
      const headings = container.querySelectorAll('h2, h3, h4, h5, [role="heading"]');
      let primaryHeading = null;
      for (const h of headings) {
        if (!isInsideNestedReshare(h, container)) {
          primaryHeading = h;
          break;
        }
      }
      if (primaryHeading) {
        debugLog.primaryAuthor = (primaryHeading.textContent || '').trim();
      }

      // Find the top-level author header container
      let topHeader = container.querySelector('header, [data-ad-comet-preview="header"]');
      if (topHeader && isInsideNestedReshare(topHeader, container)) {
        topHeader = null;
      }
      if (!topHeader && primaryHeading) {
        topHeader = primaryHeading.closest('header, [data-ad-comet-preview="header"]') ||
                    primaryHeading.closest('div[class*="header"]') ||
                    (primaryHeading.parentElement && primaryHeading.parentElement.parentElement) ||
                    primaryHeading.parentElement;
      }

      const msgEl = container.querySelector('[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-testid="post_message"]');

      // Check within topHeader if resolved
      if (topHeader) {
        const headerText = topHeader.textContent || '';
        for (const kw of SUGGESTED_TEXT_KEYWORDS) {
          if (headerText.indexOf(kw) !== -1) {
            // Guard against friend comments (e.g. "X 留言回應" or "X commented on this")
            if (headerText.indexOf('留言') === -1 && headerText.indexOf('回應') === -1 && headerText.indexOf('commented') === -1) {
              return {
                isSuggested: true,
                signal: 'Other',
                reason: 'dom:header_keyword',
                text: kw,
                debug: Object.assign({}, debugLog, { matchedKeyword: kw, headerSnippet: headerText.slice(0, 80) })
              };
            }
          }
        }

        const actionCandidates = topHeader.querySelectorAll('a[role="link"], div[role="button"], button, span[role="button"], span');
        for (const el of actionCandidates) {
          const text = (el.textContent || '').trim();
          const matchRes = matchFollowOrJoin(text);
          if (matchRes) {
            return {
              isSuggested: true,
              signal: matchRes.signal,
              reason: matchRes.reason,
              text,
              debug: Object.assign({}, debugLog, { matchedText: text, signal: matchRes.signal })
            };
          }
          const aria = (el.getAttribute('aria-label') || '').trim();
          const ariaMatchRes = matchFollowOrJoin(aria);
          if (ariaMatchRes) {
            return {
              isSuggested: true,
              signal: ariaMatchRes.signal,
              reason: ariaMatchRes.reason + '_aria',
              text: aria,
              debug: Object.assign({}, debugLog, { matchedAria: aria, signal: ariaMatchRes.signal })
            };
          }
        }
      }

      // 3. Scan the author header zone
      const scanScope = topHeader || container;
      const actionElements = scanScope.querySelectorAll('div[role="button"], button, a[role="link"], span[role="button"]');
      let extraAuthorButtonCandidate = null;

      for (const el of actionElements) {
        if (isInsideNestedReshare(el, container)) continue;
        if (!topHeader && msgEl) {
          if (msgEl.contains(el) || msgEl === el) continue;
          if (typeof msgEl.compareDocumentPosition === 'function') {
            const pos = msgEl.compareDocumentPosition(el);
            if (pos & 4) continue; // DOCUMENT_POSITION_FOLLOWING: element is after message
          }
        }

        const text = (el.textContent || '').trim();
        const aria = (el.getAttribute('aria-label') || '').trim();

        // 3a. Explicit Follow or Join by text
        const matchRes = matchFollowOrJoin(text);
        if (matchRes) {
          return {
            isSuggested: true,
            signal: matchRes.signal,
            reason: matchRes.reason,
            text,
            debug: Object.assign({}, debugLog, { matchedText: text, signal: matchRes.signal })
          };
        }

        // 3b. Explicit Follow or Join by aria-label
        const ariaMatchRes = matchFollowOrJoin(aria);
        if (ariaMatchRes) {
          return {
            isSuggested: true,
            signal: ariaMatchRes.signal,
            reason: ariaMatchRes.reason + '_aria',
            text: aria,
            debug: Object.assign({}, debugLog, { matchedAria: aria, signal: ariaMatchRes.signal })
          };
        }

        // 3c. Track potential Extra Action button in author line
        const role = el.getAttribute('role') || el.tagName.toLowerCase();
        const isButtonRole = role === 'button' || el.tagName === 'BUTTON';

        if (isButtonRole) {
          if (isCardMenuOrPrivacy(el)) {
            debugLog.excludedButtons.push({ type: 'menu_or_privacy', aria, text });
            continue;
          }
          if (isVerifiedBadge(el)) {
            debugLog.excludedButtons.push({ type: 'verified_badge', aria, text });
            continue;
          }
          if (primaryHeading && (primaryHeading.contains(el) || primaryHeading === el)) {
            debugLog.excludedButtons.push({ type: 'author_heading', aria, text });
            continue;
          }

          const hasSvg = Boolean(el.querySelector && el.querySelector('svg')) || el.tagName === 'SVG';
          // A button with NO text, NO aria-label, and NO SVG is an empty layout wrapper -> ignore
          if (!text && !aria && !hasSvg) {
            continue;
          }

          // If button contains an SVG that is a verified badge -> exclude
          if (hasSvg) {
            const svgEl = el.querySelector ? el.querySelector('svg') : el;
            if (isVerifiedBadge(svgEl)) {
              debugLog.excludedButtons.push({ type: 'verified_badge', aria, text });
              continue;
            }
          }

          // Extra action button found in author row!
          debugLog.buttonsFound.push({ role, aria, text });
          if (!extraAuthorButtonCandidate) {
            extraAuthorButtonCandidate = el;
          }
        }
      }

      // 4. If an extra action button was found in the author header row -> categorize as 'Other'
      if (extraAuthorButtonCandidate) {
        const svgEl = extraAuthorButtonCandidate.querySelector('svg') || (extraAuthorButtonCandidate.tagName === 'SVG' ? extraAuthorButtonCandidate : null);
        const candText = (extraAuthorButtonCandidate.textContent || '').trim();
        const candAria = (extraAuthorButtonCandidate.getAttribute('aria-label') || '').trim();

        if (isVerifiedBadge(extraAuthorButtonCandidate) || (svgEl && isVerifiedBadge(svgEl))) {
          // Verified badge, ignore
        } else if (candText || candAria) {
          return {
            isSuggested: true,
            signal: 'Other',
            reason: 'dom:other_extra_button',
            text: candAria || candText || 'extra_button',
            debug: Object.assign({}, debugLog, {
              matchedExtraButton: { hasSvg: Boolean(svgEl), text: candText, aria: candAria }
            })
          };
        } else if (svgEl) {
          return {
            isSuggested: true,
            signal: 'Other',
            reason: 'dom:other_svg_icon',
            text: 'svg_icon',
            debug: Object.assign({}, debugLog, {
              matchedExtraButton: { hasSvg: true, text: candText, aria: candAria }
            })
          };
        }
      }

      // 5. Pre-message suggestion labels (above [data-ad-preview="message"])
      const topSpans = container.querySelectorAll('div[dir="auto"] > span, span[dir="auto"]');
      for (const span of topSpans) {
        if (msgEl && (msgEl.contains(span) || msgEl === span)) continue;
        if (isInsideNestedReshare(span, container)) continue;
        const text = (span.textContent || '').trim();
        for (const kw of SUGGESTED_TEXT_KEYWORDS) {
          if (text === kw || (text.startsWith(kw) && text.length <= kw.length + 5)) {
            return {
              isSuggested: true,
              signal: 'Other',
              reason: 'dom:pre_message_label',
              text: kw,
              debug: Object.assign({}, debugLog, { preMessageLabel: kw })
            };
          }
        }
      }
    } catch (e) {
      // Fail open
    }
    return null;
  }

  /**
   * Title mode bar (24px single line snippet, permanent across expand/collapse).
   */
  function FBDietTitleBar(props) {
    try {
      const meta = GROUP_META[groupOf(props.category)] || GROUP_META.other;
      const isExpanded = Boolean(props.isExpanded);
      const isMini = Boolean(props.isMini);
      const showTitle = props.showTitle !== undefined ? Boolean(props.showTitle) : true;

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
          if (!showTitle) return;
          if (unitId && titleBarCache.has(unitId)) return;
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
        }, [unitId, showTitle]);
      }

      const effectiveActor = (domData && domData.actorName) || initialActor;
      const effectiveMsg = (domData && domData.snippetText) || initialMsg;
      const effectiveGroup = (domData && domData.groupName) || initialGroup;

      const badge = createEl('span', { className: 'fb-diet-badge ' + meta.badgeClass }, [meta.badgeText]);
      const contentKids = [badge];

      if (showTitle) {
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
      }

      const contentBox = createEl('div', { className: 'fb-diet-title-content' }, contentKids);

      let className = 'fb-diet-titlebar';
      if (isMini) className += ' fb-diet-titlebar-mini';
      if (isExpanded) className += ' fb-diet-state-expanded';

      return createEl(
        'div',
        {
          ref: barRef,
          className: className,
          title: isExpanded ? 'Re-fold' : 'Show post',
          onClick: props.onToggle
        },
        [contentBox]
      );
    } catch (e) {
      return null;
    }
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
    detectSuggestedFromDom,
    FBDietBar,
    FBDietTitleBar
  };
})();
