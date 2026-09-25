/**
 * FB Diet - UI and Placeholder Components (MAIN world)
 *
 * Provides React placeholder bars and group badges.
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

  const NON_AUTHOR_TEXTS = new Set([
    '為你推薦', '为你推荐', 'Suggested for you', '推薦貼文', '推荐帖子', 'Suggested post',
    '推薦你加入', '推荐你加入', 'Popular across Facebook', 'Facebook 熱門內容',
    '贊助', '赞助', 'sponsored', '廣告', '広告',
    '連續短片', '短视频', 'reels', '限時動態', '限时动态', 'stories',
    '追蹤', 'follow', '關注', '加入', 'join',
    'facebook', 'meta'
  ]);

  const UI_KEYWORDS = new Set([
    '公開', '朋友', '只限本人', 'Public', 'Friends', 'Only me',
    '讚', '留言', '分享', 'Like', 'Comment', 'Share',
    'Facebook', 'Meta', '傳送門', '查看更多', 'See more', '顯示更多', 'Show more',
    '查看原文', '為此翻譯評分', 'See original', 'Rate this translation',
    '所有留言', '最相關', '最新留言', 'All comments', 'Most relevant', 'Newest'
  ]);

  const RELATIVE_TIME_REGEX = /^[\d·\s]+(分鐘|小時|天|秒|週|年|m|h|d|w|y|hr|hrs|min|mins|sec|secs|hour|hours|day|days|week|weeks|year|years)(\s*(前|ago))?(\s*[·•]\s*(已編輯|Edited|Public|公開)?)?[\s·•]*$/i;
  const DOMAIN_REGEX = /^(?:https?:\/\/|www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(com|net|org|io|me|co|cc|app|ly|gl|tv|tw|cn|jp|us|uk|edu|gov|xyz|info|biz|site|online|live|ai|tech|dev|club|store|vip|pro|top|link|page|be)(\/[^\s]*)?$/i;

  function isRelativeTime(text) {
    if (!text || typeof text !== 'string') return false;
    const clean = text.replace(/^[·•\s+]+/, '').trim();
    if (clean.length < 1 || clean.length > 30) return false;
    if (/^(剛剛|刚刚|Just now)[\s·•]*$/i.test(clean)) return true;
    return RELATIVE_TIME_REGEX.test(clean);
  }

  function isStandaloneDomainOrUrl(text) {
    if (!text || typeof text !== 'string') return false;
    const clean = text.replace(/^[·•\s+]+/, '').trim();
    if (clean.length < 3 || clean.length > 200) return false;
    if (clean.includes(' ')) return false;
    return DOMAIN_REGEX.test(clean);
  }

  function isObfuscatedHash(text) {
    if (!text || typeof text !== 'string') return false;
    const clean = text.trim();
    if (clean.length < 24 || clean.includes(' ')) return false;
    return /^[A-Za-z0-9_-]{24,}$/.test(clean);
  }

  function extractTextWithEmojis(node) {
    if (!node) return '';
    if (node.nodeType === 3) {
      return node.nodeValue || '';
    }
    if (node.nodeType === 1 || !node.nodeType) {
      const tag = (node.tagName || '').toUpperCase();
      if (tag === 'IMG' || (node.getAttribute && node.getAttribute('role') === 'img')) {
        const alt = (node.getAttribute && (node.getAttribute('alt') || node.getAttribute('aria-label'))) || '';
        if (alt) return alt;
      }
      if (node.classList && (node.classList.contains('fb-diet-probe-group') || node.classList.contains('fb-diet-probe-popup'))) {
        return '';
      }
      const kids = node.childNodes && node.childNodes.length > 0 ? node.childNodes : (node.children || []);
      if (kids.length > 0) {
        let text = '';
        for (const child of kids) {
          text += extractTextWithEmojis(child);
        }
        return text;
      }
      return node.textContent || '';
    }
    return node.textContent || '';
  }

  function isNonAuthor(text) {
    if (!text || typeof text !== 'string') return true;
    const clean = text.replace(/^[·•\s+]+/, '').replace(/\s+/g, ' ').trim();
    if (clean.length < 2 || clean.length > 80) return true;
    if (clean.startsWith('#')) return true;
    if (isStandaloneDomainOrUrl(clean)) return true;
    if (isObfuscatedHash(clean)) return true;
    if (clean.includes('.com') || clean.includes('.net') || clean.includes('.org') || clean.includes('.io') || clean.startsWith('http') || clean.startsWith('www.')) return true;
    if (NON_AUTHOR_TEXTS.has(clean) || UI_KEYWORDS.has(clean)) return true;
    const lower = clean.toLowerCase();
    for (const kw of NON_AUTHOR_TEXTS) {
      if (lower === kw.toLowerCase()) return true;
    }
    for (const kw of UI_KEYWORDS) {
      if (lower === kw.toLowerCase()) return true;
    }
    if (isRelativeTime(clean)) return true;
    return false;
  }

  function isUiOrActionText(text) {
    if (!text || typeof text !== 'string') return true;
    const clean = text.replace(/^[·•\s+]+/, '').trim();
    if (clean.length < 2) return true;
    if (UI_KEYWORDS.has(clean) || NON_AUTHOR_TEXTS.has(clean)) return true;
    const lower = clean.toLowerCase();
    for (const kw of UI_KEYWORDS) {
      if (lower === kw.toLowerCase()) return true;
    }
    for (const kw of NON_AUTHOR_TEXTS) {
      if (lower === kw.toLowerCase()) return true;
    }
    if (isRelativeTime(clean)) return true;
    if (isStandaloneDomainOrUrl(clean)) return true;
    if (isObfuscatedHash(clean)) return true;
    if (/^[·•\s]*(追蹤|Follow|關注|加入|Join)[·•\s]*$/i.test(clean)) return true;
    if (/^[·•\s]*(查看原文|為此翻譯評分|See original|Rate this translation)/i.test(clean)) return true;
    return false;
  }

  function isExcludedLinkHref(href) {
    if (!href || typeof href !== 'string') return false;
    const h = href.toLowerCase().trim();
    if (!h) return false;

    // Group link without /user/ is the group page/feed, not an author
    if (h.includes('/groups/') && !h.includes('/user/')) return true;

    if (
      h.includes('/posts/') ||
      h.includes('/permalink/') ||
      h.includes('permalink.php') ||
      h.includes('story_fbid=') ||
      h.includes('/videos/') ||
      h.includes('/watch/') ||
      h.includes('/ads/') ||
      h.includes('/ad_preferences/') ||
      h.includes('/photo') ||
      h.includes('/photos/') ||
      h.includes('/reel/') ||
      h.includes('/reels/') ||
      h.includes('/hashtag/') ||
      h.includes('/events/') ||
      h.includes('/marketplace/') ||
      h.includes('/gaming/') ||
      h.includes('/policies/') ||
      h.includes('/help/') ||
      h.includes('/settings/')
    ) return true;

    // Root or query-only links (e.g. '/', '/?__cft__...', '#', 'https://www.facebook.com/?...')
    const cleanPath = h.replace(/^https?:\/\/[^/]+/i, '').split('?')[0].split('#')[0];
    if (cleanPath === '' || cleanPath === '/') return true;

    return false;
  }

  function cleanPostSnippet(rawText, author, group) {
    if (!rawText || typeof rawText !== 'string') return '';
    let text = rawText.split('\n')[0].trim();
    if (author) {
      const esc = author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp('^' + esc + '[:\\s·•]*', 'i'), '');
    }
    if (group) {
      const escG = group.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp('^' + escG + '[:\\s·•]*', 'i'), '');
    }
    // Strip leading actions like · 追蹤 / · Follow / 追蹤
    text = text.replace(/^[·•\s]*(追蹤|Follow|關注|加入|Join)[·•\s]*/i, '');
    // Strip trailing translation notice
    text = text.replace(/[·•\s]*(查看原文|為此翻譯評分|See original|Rate this translation)[\s\S]*$/i, '').trim();
    return text.trim();
  }

  function extractAuthorFromDom(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return null;
    try {
      const groupName = extractGroupFromDom(container);

      // 1. Group member link: a[href*="/user/"] or a[href*="/groups/"][href*="/user/"]
      const userLinks = container.querySelectorAll('a[href*="/user/"]');
      for (const ul of userLinks) {
        if (isInsideProbeUi(ul) || isInsideCommentSection(ul)) continue;
        const text = (ul.textContent || ul.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        if (text && !isNonAuthor(text) && (!groupName || text !== groupName)) {
          return text;
        }
      }

      // 2. Headings: search ALL links inside h2..h5 / [role="heading"]
      const headings = container.querySelectorAll('h2, h3, h4, h5, [role="heading"]');
      for (const h of headings) {
        if (isInsideProbeUi(h) || isInsideCommentSection(h)) continue;
        const links = h.querySelectorAll('a[role="link"], a[href]');
        for (const link of links) {
          const href = (link.getAttribute('href') || link.href || '').toLowerCase();
          if (isExcludedLinkHref(href)) continue;
          const text = (link.textContent || link.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
          if (text && !isNonAuthor(text) && (!groupName || text !== groupName)) {
            return text;
          }
        }
        const text = h.textContent.trim();
        if (text === '匿名成員' || text === 'Anonymous participant') return text;
      }

      // 3. Header zone / Strong link
      const strongLinks = container.querySelectorAll('a[role="link"] strong, strong a[role="link"], header a[role="link"], [data-ad-comet-preview="header"] a');
      for (const sl of strongLinks) {
        if (isInsideProbeUi(sl) || isInsideCommentSection(sl)) continue;
        const link = sl.tagName === 'A' ? sl : (sl.closest ? sl.closest('a') : null);
        if (link) {
          const href = (link.getAttribute('href') || link.href || '').toLowerCase();
          if (isExcludedLinkHref(href)) continue;
        }
        const text = (sl.textContent || sl.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        if (text && !isNonAuthor(text) && (!groupName || text !== groupName)) {
          return text;
        }
      }

      // 4. Top profile links in card
      const links = container.querySelectorAll('a[role="link"], a[href]');
      for (const a of links) {
        if (isInsideProbeUi(a) || isInsideCommentSection(a)) continue;
        const href = (a.getAttribute('href') || a.href || '').toLowerCase();
        if (isExcludedLinkHref(href)) continue;
        const text = (a.textContent || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        if (text && !isNonAuthor(text) && (!groupName || text !== groupName)) {
          return text;
        }
      }

      // 5. Fallback: Image alt / aria-label ({AuthorName} 貼文的相片 / Photo by {AuthorName})
      const labeledMedia = container.querySelectorAll('img[alt], [aria-label*="貼文的相片"], [aria-label*="\'s post"], [aria-label*="帖子的照片"]');
      for (const m of labeledMedia) {
        if (isInsideProbeUi(m) || isInsideCommentSection(m)) continue;
        const label = (m.getAttribute('aria-label') || m.getAttribute('alt') || '').trim();
        const match = label.match(/^(.+?)\s*(?:貼文的相片|的相片|帖子的照片|'s post)/i);
        if (match) {
          const cand = match[1].replace(/\s+/g, ' ').trim();
          if (cand && !isNonAuthor(cand) && (!groupName || cand !== groupName)) {
            return cand;
          }
        }
      }
    } catch (e) {}
    return null;
  }

  function extractPostTitleFromDom(container, author, group) {
    if (!container || typeof container.querySelectorAll !== 'function') return null;
    try {
      const headings = container.querySelectorAll('h2, h3, h4, h5, [role="heading"]');
      for (const h of headings) {
        if (h.closest && h.closest('header, [data-ad-comet-preview="header"], [role="button"], button, [aria-haspopup="menu"]')) continue;
        if (h.querySelector && h.querySelector('[role="button"], button, [aria-haspopup="menu"]')) continue;

        const text = extractTextWithEmojis(h).trim();
        if (isUiOrActionText(text)) continue;

        // Skip author headings or group headings
        if (author && (text === author || text.includes(author))) continue;
        if (group && (text === group || text.includes(group))) continue;

        // Headings containing Follow / Join actions are author/header rows
        if (/([·•\s]|^)(追蹤|Follow|關注|加入|Join)([·•\s]|$)/i.test(text)) continue;

        const link = h.querySelector('a[role="link"], a[href]');
        if (link) {
          const linkText = link.textContent.trim();
          if (author && (linkText === author || linkText.includes(author))) continue;
          if (group && (linkText === group || linkText.includes(group))) continue;

          const href = (link.getAttribute('href') || link.href || '').toLowerCase();
          if (
            href.includes('/groups/') ||
            href.includes('/user/') ||
            href.includes('/stories/') ||
            href.includes('/profile.php') ||
            (!href.includes('/posts/') && !href.includes('/permalink/') && href.startsWith('/'))
          ) {
            continue;
          }
        }

        const cleanTitle = cleanPostSnippet(text, author, group);
        if (!cleanTitle || isUiOrActionText(cleanTitle)) continue;

        return {
          node: h,
          text: cleanTitle
        };
      }
    } catch (e) {}
    return null;
  }

  function extractMessageFromDom(container, author, group) {
    if (!container || typeof container.querySelector !== 'function') return null;
    try {
      const effectiveAuthor = author !== undefined ? author : extractAuthorFromDom(container);
      const effectiveGroup = group !== undefined ? group : extractGroupFromDom(container);

      const titleObj = extractPostTitleFromDom(container, effectiveAuthor, effectiveGroup);
      const postTitle = titleObj ? titleObj.text : null;

      let postBody = null;
      const msgEl = container.querySelector('[data-ad-preview="message"], [data-ad-comet-preview="message"], [data-testid="post_message"]');
      if (msgEl) {
        const text = extractTextWithEmojis(msgEl).trim();
        if (text && !isUiOrActionText(text)) {
          const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
          if (lines.length > 0) {
            const cleanedFirst = cleanPostSnippet(lines[0], effectiveAuthor, effectiveGroup);
            if (postTitle && cleanedFirst === postTitle) {
              postBody = lines.length > 1 ? cleanPostSnippet(lines[1], effectiveAuthor, effectiveGroup) : null;
            } else {
              postBody = cleanedFirst;
            }
          }
        }
      }

      if (!postBody) {
        const dirEls = container.querySelectorAll('div[dir="auto"], span[dir="auto"]');
        for (const el of dirEls) {
          if (titleObj && titleObj.node && (titleObj.node === el || (titleObj.node.contains && titleObj.node.contains(el)))) continue;
          if (el.closest && el.closest('header, [data-ad-comet-preview="header"], h2, h3, h4, h5, [role="heading"], [role="button"], button, [aria-haspopup="menu"]')) continue;
          const text = extractTextWithEmojis(el).trim();
          if (isUiOrActionText(text)) continue;
          if (effectiveAuthor && (text === effectiveAuthor || text.includes(effectiveAuthor))) continue;
          if (effectiveGroup && (text === effectiveGroup || text.includes(effectiveGroup))) continue;
          const cleaned = cleanPostSnippet(text, effectiveAuthor, effectiveGroup);
          if (!cleaned || isUiOrActionText(cleaned)) continue;
          postBody = cleaned;
          break;
        }
      }

      if (postTitle && postBody) {
        if (postBody === postTitle || postBody.startsWith(postTitle)) return postBody;
        if (postTitle.startsWith(postBody)) return postTitle;
        return postTitle + ' ' + postBody;
      }
      if (postTitle) return postTitle;
      if (postBody) return postBody;
    } catch (e) {}
    return null;
  }

  function isInsideCommentSection(el) {
    if (!el || typeof el.closest !== 'function') return false;
    return Boolean(
      el.closest('form') ||
      el.closest('[aria-label="留言"], [aria-label="Comments"], [aria-label="回覆"], [aria-label="Replies"]') ||
      el.closest('[data-testid="UFI2CommentsList/root_depth_0"]') ||
      el.closest('[role="region"][aria-label*="留言"], [role="region"][aria-label*="Comments"]')
    );
  }

  function isInsideProbeUi(el) {
    if (!el || typeof el.closest !== 'function') return false;
    return Boolean(el.closest('.fb-diet-probe-group, .fb-diet-probe-popup, .fb-diet-probe-btn'));
  }

  function stripTrackingParams(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const u = new URL(url.startsWith('/') ? 'https://www.facebook.com' + url : url);
      const trackingKeys = [
        'fbclid', '__cft__', '__cft__[0]', '__tn__', 'ref', 'ref_component', 'ref_page',
        'hoisted_section_header_type', 'extid', 'sfnsn', 'mibextid', 'rdid'
      ];
      for (const k of trackingKeys) {
        u.searchParams.delete(k);
      }
      for (const p of Array.from(u.searchParams.keys())) {
        if (p.startsWith('__cft__') || p.startsWith('__tn__')) {
          u.searchParams.delete(p);
        }
      }
      let cleaned = u.toString();
      if (cleaned.endsWith('?')) cleaned = cleaned.slice(0, -1);
      return cleaned;
    } catch (e) {
      return url.split('?')[0];
    }
  }

  function extractTimestampFromDom(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return null;
    try {
      // 1. Direct search on links matching relative time
      const links = container.querySelectorAll('a[role="link"], a[href]');
      for (const a of links) {
        if (isInsideProbeUi(a) || isInsideCommentSection(a)) continue;
        const text = (a.textContent || '').replace(/^[·•\s+]+/, '').replace(/[·•\s+]+$/, '').trim();
        if (isRelativeTime(text)) {
          const full = a.href || a.getAttribute('href');
          const abs = full && full.startsWith('/') ? 'https://www.facebook.com' + full : full;
          return {
            text: text,
            url: abs || null
          };
        }
      }

      // 2. Elements matching relative time, searching for enclosing or descendant link
      const timeEls = container.querySelectorAll('span, div');
      for (const el of timeEls) {
        if (isInsideProbeUi(el) || isInsideCommentSection(el)) continue;
        const text = (el.textContent || '').replace(/^[·•\s+]+/, '').replace(/[·•\s+]+$/, '').trim();
        if (isRelativeTime(text)) {
          const a = (el.tagName === 'A' ? el : (el.closest ? el.closest('a') : null)) || (el.querySelector ? el.querySelector('a') : null);
          const full = a ? (a.href || a.getAttribute('href')) : null;
          const abs = full && full.startsWith('/') ? 'https://www.facebook.com' + full : full;
          return {
            text: text,
            url: abs || null
          };
        }
      }
    } catch (e) {}
    return null;
  }

  function extractAllUrlsFromDom(container, postId, authorUsername, groupId, author) {
    const urls = {
      primary: null,
      raw: null,
      domPermalink: null,
      synthesized: null,
      authorProfile: null,
      groupUrl: null,
      adUrl: null,
      timestamp: null
    };
    if (!container) return urls;
    try {
      urls.adUrl = extractAdUrlFromDom(container);

      // 1. Group URL
      const groupLinks = container.querySelectorAll ? container.querySelectorAll('a[href*="/groups/"]') : [];
      for (const gl of groupLinks) {
        const href = gl.href || gl.getAttribute('href') || '';
        if (href && !href.includes('/permalink/') && !href.includes('/posts/') && !href.includes('/user/')) {
          urls.groupUrl = href.startsWith('/') ? 'https://www.facebook.com' + href : href;
          break;
        }
      }

      // 2. Author Profile URL
      const authorLinks = container.querySelectorAll ? container.querySelectorAll('a[role="link"], a[href]') : [];
      let bestProfileUrl = null;
      let fallbackProfileUrl = null;

      for (const al of authorLinks) {
        if (isInsideProbeUi(al) || isInsideCommentSection(al)) continue;
        const href = (al.getAttribute('href') || al.href || '').toLowerCase();
        if (href && !isExcludedLinkHref(href)) {
          const full = al.href || al.getAttribute('href');
          const abs = full && full.startsWith('/') ? 'https://www.facebook.com' + full : full;
          const text = (al.textContent || '').replace(/\s+/g, ' ').trim();

          const isStory = href.includes('/stories/');
          if (author && text === author) {
            bestProfileUrl = abs;
            break;
          }
          if (!isStory && !bestProfileUrl) {
            bestProfileUrl = abs;
          } else if (!fallbackProfileUrl) {
            fallbackProfileUrl = abs;
          }
        }
      }
      urls.authorProfile = bestProfileUrl || fallbackProfileUrl || null;

      // 3. DOM permalink
      const links = container.querySelectorAll ? container.querySelectorAll('a[role="link"], a[href]') : [];
      for (const a of links) {
        const href = a.href || a.getAttribute('href') || '';
        if (
          href.indexOf('/posts/') !== -1 ||
          href.indexOf('/permalink/') !== -1 ||
          href.indexOf('permalink.php') !== -1 ||
          href.indexOf('/videos/') !== -1 ||
          href.indexOf('/photos/') !== -1 ||
          href.indexOf('story_fbid=') !== -1 ||
          (postId && href.indexOf(postId) !== -1)
        ) {
          urls.domPermalink = href.startsWith('/') ? 'https://www.facebook.com' + href : href;
          break;
        }
      }

      // 4. Synthesized URL
      const pagePath = typeof window !== 'undefined' && window.location && window.location.pathname ? window.location.pathname : '';
      const pageGroupMatch = pagePath.match(/\/groups\/([^/?]+)/);
      const effectiveGroup = groupId || (pageGroupMatch ? pageGroupMatch[1] : null) || (urls.groupUrl ? (urls.groupUrl.match(/\/groups\/([^/?]+)/) || [])[1] : null);

      if (postId && effectiveGroup) {
        urls.synthesized = 'https://www.facebook.com/groups/' + effectiveGroup + '/permalink/' + postId + '/';
      } else if (postId && authorUsername) {
        urls.synthesized = 'https://www.facebook.com/' + authorUsername + '/posts/' + postId;
      }

      // 5. Timestamp URL (fallback for permalink)
      const tsObj = extractTimestampFromDom(container);
      if (tsObj && tsObj.url) {
        urls.timestamp = tsObj.url;
        if (!urls.domPermalink) {
          urls.domPermalink = tsObj.url;
        }
      }

      const best = urls.domPermalink || urls.synthesized || urls.adUrl || null;
      urls.raw = best;
      if (best) {
        const cleaned = stripTrackingParams(best);
        const hasSpecificPostPath = /[/](posts|permalink|videos|photos|watch|reel|reels)[/]|permalink\.php|story_fbid=/.test(best);
        urls.primary = hasSpecificPostPath ? cleaned : best;
      } else {
        urls.primary = null;
      }
    } catch (e) {}
    return urls;
  }

  function extractGroupFromDom(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return null;
    try {
      const groupLinks = container.querySelectorAll('a[href*="/groups/"]');
      for (const groupLink of groupLinks) {
        const href = (groupLink.getAttribute('href') || groupLink.href || '').toLowerCase();
        if (href.includes('/permalink/') || href.includes('/posts/') || href.includes('/user/')) continue;
        const text = groupLink.textContent.trim();
        if (text && text.length > 1 && text.length < 80 && !isNonAuthor(text)) {
          if (!isRelativeTime(text)) {
            return text;
          }
        }
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
      const urls = extractAllUrlsFromDom(container);
      return urls.primary || urls.raw || null;
    } catch (e) {}
    return null;
  }

  function extractMediaFromDom(container, isMediaGroup) {
    if (!container || typeof container.querySelector !== 'function') return null;
    try {
      if (container.querySelector('video, [data-video-id]')) return '[🎬 影片]';
      if (!isMediaGroup) {
        const imgs = container.querySelectorAll('img[src*="fbcdn"]');
        let count = imgs.length;

        // Check for +N count overlay (e.g. "+3", "+5")
        const allSpans = container.querySelectorAll('span, div');
        for (const el of allSpans) {
          const t = el.textContent ? el.textContent.trim() : '';
          const m = t.match(/^\+(\d+)$/);
          if (m) {
            const extra = parseInt(m[1], 10);
            if (extra > 0) {
              count = count + extra;
              break;
            }
          }
        }

        if (count > 1) return '[📷 相片 x' + count + ']';
        if (count === 1) return '[📷 相片]';
      }
    } catch (e) {}
    return null;
  }

  function scanTextCandidates(container, author, group) {
    const candidates = [];
    if (!container || typeof container.querySelectorAll !== 'function') return candidates;
    try {
      const titleObj = extractPostTitleFromDom(container, author, group);
      const titleNode = titleObj ? titleObj.node : null;
      let acceptedBodyCount = 0;

      const elements = container.querySelectorAll('h2, h3, h4, h5, [role="heading"], div[dir="auto"], span[dir="auto"]');
      for (const el of elements) {
        if (candidates.length >= 10) break;
        if (isInsideProbeUi(el)) continue;

        const rawText = extractTextWithEmojis(el).trim();
        if (!rawText) continue;

        // Deduplicate identical immediate text
        if (candidates.some((c) => c.text === rawText.slice(0, 30))) continue;

        let status = 'candidate';
        const tag = (el.tagName || (el.getAttribute && el.getAttribute('role')) || 'DIV').toUpperCase();

        if (isInsideCommentSection(el)) {
          status = 'skipped:comment-section';
        } else if (titleNode && (titleNode === el || (titleNode.contains && titleNode.contains(el)))) {
          status = 'accepted:post-title';
        } else if (el.closest && el.closest('header, [data-ad-comet-preview="header"]')) {
          status = 'skipped:in-header';
        } else if (el.closest && el.closest('[role="button"], button, [aria-haspopup="menu"]')) {
          status = 'skipped:ui-button';
        } else if (isStandaloneDomainOrUrl(rawText)) {
          status = 'skipped:url-domain';
        } else if (isObfuscatedHash(rawText)) {
          status = 'skipped:obfuscated-hash';
        } else if (isUiOrActionText(rawText)) {
          status = 'skipped:ui-branding';
        } else if (author && (rawText === author || rawText.includes(author))) {
          status = 'skipped:author-heading';
        } else if (group && (rawText === group || rawText.includes(group))) {
          status = 'skipped:group-name';
        } else if (/([·•\s]|^)(追蹤|Follow|關注|加入|Join)([·•\s]|$)/i.test(rawText)) {
          status = 'skipped:action-text';
        } else if (acceptedBodyCount === 0) {
          status = 'accepted:post-body';
          acceptedBodyCount++;
        } else {
          status = 'secondary:body-text';
        }

        candidates.push({
          index: candidates.length,
          tag,
          text: rawText.slice(0, 30),
          status
        });
      }
    } catch (e) {}
    return candidates;
  }

  function extractReshareFromDom(container, mainAuthor) {
    if (!container || typeof container.querySelectorAll !== 'function') return null;
    try {
      const quotes = container.querySelectorAll('[role="article"], blockquote, div[class*="quote"]');
      for (const q of quotes) {
        if (q === container) continue;
        const innerAuthor = extractAuthorFromDom(q);
        if (innerAuthor && innerAuthor !== mainAuthor) {
          const innerMsg = extractMessageFromDom(q, innerAuthor);
          const innerUrl = extractPostUrlFromDom(q);
          return {
            originalActor: innerAuthor,
            originalTitle: innerMsg,
            originalPermalink: innerUrl
          };
        }
      }
    } catch (e) {}
    return null;
  }

  function getMediaLabel(category) {
    if (typeof window !== 'undefined' && window.FBDietI18N && typeof window.FBDietI18N.t === 'function') {
      if (category === 'stories') return window.FBDietI18N.t('labelStories');
      if (category === 'reels') return window.FBDietI18N.t('labelReels');
      if (category === 'suggestedGroup') return window.FBDietI18N.t('labelSuggestedGroup');
    }
    const isZh = (() => {
      try {
        const doc = typeof document !== 'undefined' ? document : (typeof window !== 'undefined' ? window.document : null);
        const docLang = (doc && doc.documentElement && doc.documentElement.lang) || '';
        if (docLang.toLowerCase().startsWith('zh')) return true;
        const nav = typeof navigator !== 'undefined' ? navigator : (typeof window !== 'undefined' ? window.navigator : null);
        const navLang = (nav && nav.language) || '';
        if (navLang.toLowerCase().startsWith('zh')) return true;
      } catch (e) {}
      return false;
    })();

    if (category === 'stories') {
      return isZh ? '限時動態' : 'Stories';
    }
    if (category === 'reels') {
      return isZh ? '連續短片' : 'Reels';
    }
    if (category === 'suggestedGroup') {
      return isZh ? '推薦社團列表' : 'Suggested Groups';
    }
    return '';
  }

  function collectDomMetadata(container, isMediaGroup) {
    if (!container || typeof container.querySelector !== 'function') return null;
    if (isMediaGroup) {
      return {
        actor: null,
        snippet: null,
        title: null,
        group: null,
        postUrl: null,
        urls: {},
        adUrl: null,
        media: null,
        textCandidates: [],
        reshare: null
      };
    }
    try {
      const actor = extractAuthorFromDom(container);
      const group = extractGroupFromDom(container);
      const timestamp = extractTimestampFromDom(container);
      const urls = extractAllUrlsFromDom(container, null, null, null, actor);
      const titleObj = extractPostTitleFromDom(container, actor, group);
      const textCandidates = scanTextCandidates(container, actor, group);
      const reshare = extractReshareFromDom(container, actor);

      return {
        actor,
        snippet: extractMessageFromDom(container, actor, group),
        title: titleObj ? { tag: titleObj.node ? titleObj.node.tagName : 'H2', text: titleObj.text } : null,
        group,
        timestamp,
        postUrl: urls.primary || urls.raw || null,
        urls,
        adUrl: urls.adUrl || null,
        media: extractMediaFromDom(container, isMediaGroup),
        textCandidates,
        reshare
      };
    } catch (e) {
      return null;
    }
  }

  const domMetadataExtractor = {
    collect: collectDomMetadata,
    extractAuthorFromDom,
    extractPostTitleFromDom,
    extractMessageFromDom,
    extractGroupFromDom,
    extractTimestampFromDom,
    extractTextWithEmojis,
    extractAdUrlFromDom,
    extractPostUrlFromDom,
    extractAllUrlsFromDom,
    extractMediaFromDom,
    scanTextCandidates,
    extractReshareFromDom,
    stripTrackingParams
  };
  window.FBDietDOMMetadata = domMetadataExtractor;

  /**
   * Title mode bar (24px single line snippet, permanent across expand/collapse).
   */
  function FBDietTitleBar(props) {
    try {
      const meta = GROUP_META[groupOf(props.category)] || GROUP_META.other;
      const isExpanded = Boolean(props.isExpanded);
      const isMini = Boolean(props.isMini);
      const showTitle = props.showTitle !== undefined ? Boolean(props.showTitle) : true;
      const isStaticCategory = props.category === 'reels' || props.category === 'stories' || props.category === 'suggestedGroup';

      const React = window.FBDietProxy ? window.FBDietProxy.getReact() : null;
      const barRef = React && typeof React.useRef === 'function' ? React.useRef(null) : { current: null };

      const unitId = props.unitId;
      const cached = unitId ? titleBarCache.get(unitId) : null;
      const [domData, setDomData] = (React && typeof React.useState === 'function')
        ? React.useState(cached || null)
        : [cached || null, () => {}];

      const enrichment = props.enrichment || null;
      const initialActor = (enrichment && enrichment.actor && enrichment.actor.name) || (domData && domData.actorName) || (cached && cached.actorName) || '';
      const initialMsg = (enrichment && enrichment.content && (enrichment.content.message || enrichment.content.title)) || (domData && domData.snippetText) || (cached && cached.snippetText) || '';
      const initialGroup = (enrichment && enrichment.group && enrichment.group.name) || (domData && domData.groupName) || (cached && cached.groupName) || '';

      if (React && typeof React.useEffect === 'function') {
        React.useEffect(() => {
          if (!showTitle || isStaticCategory) return;
          if (initialActor && initialMsg) return;
          if (cached && cached.actorName && cached.snippetText) return;
          const el = barRef && barRef.current;
          if (!el) return;
          const container = el.nextElementSibling || (el.parentElement ? el.parentElement.querySelector('.fb-diet-fold-hidden, .fb-diet-expand-body, .fb-diet-full-container') : null);
          if (!container) return;

          let observer = null;
          let active = true;

          const scan = () => {
            if (!active) return false;
            const domMetadata = collectDomMetadata(container, isStaticCategory);
            const foundActor = initialActor || (domMetadata && domMetadata.actor);
            const foundMsg = initialMsg || (domMetadata && domMetadata.snippet);
            const foundGroup = initialGroup || (domMetadata && domMetadata.group);
            const foundAdUrl = (domMetadata && domMetadata.adUrl) || '';
            const foundMedia = (!foundMsg && domMetadata && domMetadata.media) || '';

            if (foundActor || foundMsg || foundGroup || foundMedia || foundAdUrl) {
              const newData = {
                actorName: foundActor || '',
                snippetText: foundMsg || foundMedia || '',
                groupName: foundGroup || '',
                adUrl: foundAdUrl || ''
              };
              if (unitId) titleBarCache.set(unitId, newData);
              setDomData(newData);
              if (foundActor && (foundMsg || foundMedia)) {
                if (observer) {
                  try { observer.disconnect(); } catch (e) {}
                  observer = null;
                }
                return true;
              }
            }
            return false;
          };

          if (scan()) return;

          const MutationObs = window.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
          if (MutationObs) {
            try {
              observer = new MutationObs(() => {
                scan();
              });
              observer.observe(container, { childList: true, subtree: true, characterData: true });
            } catch (e) {}
          }

          const delays = [50, 150, 400, 1000, 2500];
          const timers = delays.map((d) => setTimeout(scan, d));

          return () => {
            active = false;
            if (observer) {
              try { observer.disconnect(); } catch (e) {}
            }
            timers.forEach((t) => clearTimeout(t));
          };
        }, [unitId, showTitle, isExpanded]);
      }

      const effectiveActor = (domData && domData.actorName) || initialActor;
      const effectiveMsg = (domData && domData.snippetText) || initialMsg;
      const effectiveGroup = (domData && domData.groupName) || initialGroup;

      const badge = createEl('span', { className: 'fb-diet-badge ' + meta.badgeClass }, [meta.badgeText]);
      const contentKids = [badge];

      if (showTitle) {
        // Group name (with max-width: 140px in css)
        if (effectiveGroup && !isStaticCategory) {
          contentKids.push(
            createEl('span', { className: 'fb-diet-title-group', title: effectiveGroup }, [
              '[',
              createEl('span', { className: 'fb-diet-title-group-name' }, [effectiveGroup]),
              ']'
            ])
          );
        }

        // Author string & reshare detection
        let authorText = '';
        if (isStaticCategory) {
          authorText = getMediaLabel(props.category);
        } else if (effectiveActor) {
          authorText = effectiveActor + ':';
        }

        if (authorText) {
          const authorClass = isStaticCategory ? 'fb-diet-title-media' : 'fb-diet-title-author';
          contentKids.push(
            createEl('span', { className: authorClass, title: authorText }, [authorText])
          );
        }

        // Message snippet / title / media fallback
        let snippetText = isStaticCategory ? null : (effectiveMsg ? cleanPostSnippet(effectiveMsg, effectiveActor, effectiveGroup) : null);
        if (!snippetText && !isStaticCategory) {
          const media = enrichment && enrichment.media;
          if (media && media.hasVideo) {
            snippetText = '🎬 [影片]';
          } else if (media && (media.count > 0 || media.isMultiImage)) {
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
    FBDietBar,
    FBDietTitleBar,
    getMediaLabel,
    domMetadata: domMetadataExtractor,
    extractAuthorFromDom,
    extractMessageFromDom,
    extractGroupFromDom,
    extractAdUrlFromDom,
    extractPostUrlFromDom,
    extractMediaFromDom
  };
})();
