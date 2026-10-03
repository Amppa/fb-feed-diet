/**
 * FB Diet - mounted-DOM surface module: tray vocabulary + reels/stories/group decision.
 * DOM-only pipeline only; `relay` decides these from the store. // per STRATEGY.md §3.2
 */
window.FBDietDOMSurface = (() => {
  'use strict';

  const defaults = window.FB_DIET_DEFAULTS || globalThis.FB_DIET_DEFAULTS || {};
  const keywords = defaults.KEYWORDS || {};

  function wordList(name) {
    return Array.isArray(keywords[name]) ? keywords[name].map((word) => String(word).toLowerCase()) : [];
  }

  const REELS_WORDS = wordList('REELS');
  const STORIES_WORDS = wordList('STORIES');
  const CONTENT_SURFACE_WORDS = REELS_WORDS.concat(STORIES_WORDS);

  /** Exact-match surface label (never substring). // per STRATEGY.md §3.2 */
  function matchSurfaceWord(value, words) {
    const text = (value || '').trim().toLowerCase();
    if (!text) return false;
    return words.indexOf(text) !== -1;
  }

  function isReelsSurfaceLabel(value) {
    return matchSurfaceWord(value, REELS_WORDS);
  }

  function isStoriesSurfaceLabel(value) {
    return matchSurfaceWord(value, STORIES_WORDS);
  }

  function isContentSurfaceLabel(value) {
    return matchSurfaceWord(value, CONTENT_SURFACE_WORDS);
  }

  /** True when the marker is the unit's own surface, not content it displays. */
  function isTraySurfaceMarker(el, container) {
    if (!el) return false;
    if (el === container) return true;
    let cur = el.parentElement;
    while (cur && cur !== container) {
      if (cur.getAttribute && cur.getAttribute('role') === 'article') return false;
      const preview = cur.getAttribute && cur.getAttribute('data-ad-preview');
      // 'message' is the post body itself; the other two are the reshare/attachment wrappers. Any of
      // them means the marker is inside content the unit merely displays.
      if (preview === 'message' || preview === 'message_container' || preview === 'attachment') return false;
      cur = cur.parentElement;
    }
    return true;
  }

  /** Tray shape (structure beats text). Ring=1 link, tray=row; threshold 3. // per STRATEGY.md §3.2 */
  function isHorizontalTray(container) {
    const structural = findStructuralTray(container);
    if (structural) return structural.kind;
    try {
      const hrefs = distinctSurfaceHrefs(container, STORIES_LINK_SELECTOR);
      if (hrefs.size >= MIN_STORY_TRAY_LINKS) return 'stories_link';
      return null;
    } catch (e) {
      return null;
    }
  }

  /** Veto tray: groups_carousel needs group wording too. // per STRATEGY.md §3.2 */
  function trayVetoFor(container) {
    const kind = isHorizontalTray(container);
    if (kind !== 'groups_carousel') return kind;
    const labels = readSurfaceLabels(container);
    const groupLabel = labels.group || matchGroupWord(readTrayRegionName(container));
    return groupLabel ? kind : null;
  }

  /** Structural tray marker on the unit's own surface, or null. */
  function findStructuralTray(container) {
    try {
      const hscroll = container.querySelector('[data-type="hscroll-child"]');
      if (hscroll && isTraySurfaceMarker(hscroll, container)) {
        return { el: hscroll, kind: 'hscroll_child', groupLinks: 0 };
      }
      // The region is held to the same "own surface" test as the marker, for the same reason: a post
      // quoting a story, or a comment under a story region, contains these at depth and is still
      // just a post.
      const region = container.querySelector('[role="region"]');
      if (region && isTraySurfaceMarker(region, container)) {
        const label = (region.getAttribute('aria-label') || '').toLowerCase();
        if (CONTENT_SURFACE_WORDS.some((word) => label.indexOf(word) !== -1)) {
          return { el: region, kind: 'tray_region', groupLinks: 0 };
        }
      }
      const groupLinks = countGroupCarouselLinks(container);
      if (groupLinks >= MIN_GROUP_TRAY_LINKS) return { el: container, kind: 'groups_carousel', groupLinks };
      return null;
    } catch (e) {
      return null;
    }
  }

  /** Distinct hrefs on the unit's own surface, own UI excluded. */
  function distinctSurfaceHrefs(container, selector) {
    const hrefs = new Set();
    try {
      const nodes = container.querySelectorAll(selector);
      for (let i = 0; i < nodes.length; i += 1) {
        const el = nodes[i];
        if (isInsideOwnUi(el, container)) continue;
        // The own-surface guard, same as everywhere else in this module: links inside a message
        // body or a quoted post are content the unit displays, not the unit's own shape.
        if (!isTraySurfaceMarker(el, container)) continue;
        const href = el.getAttribute('href') || '';
        if (href) hrefs.add(href);
      }
    } catch (e) {
      return hrefs;
    }
    return hrefs;
  }

  /** Group carousel: distinct profile count on own surface. */
  function countGroupCarouselLinks(container) {
    // The threshold is spent on cards only — see `NON_PROFILE_GROUP_ROUTES` for the chrome links
    // this excludes and why counting them would let a weak unit clear it.
    let count = 0;
    distinctSurfaceHrefs(container, GROUP_PROFILE_LINK_SELECTOR).forEach((href) => {
      if (isGroupProfileHref(href)) count += 1;
    });
    return count;
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

  /* Positive surface classification. // per STRATEGY.md §3.2 */

  // `story_fbid=` excluded: it also marks ordinary photo permalinks.
  const REELS_LINK_SELECTOR = 'a[href*="/reels/"], a[href*="/reel/"]';
  const STORIES_LINK_SELECTOR = 'a[href*="/stories/"]';
  const GROUP_PROFILE_LINK_SELECTOR = 'a[href*="/groups/"]';
  const MIN_GROUP_TRAY_LINKS = 3;
  const MIN_STORY_TRAY_LINKS = 3;
  // Chrome links are not group cards; threshold spent on cards only.
  const NON_PROFILE_GROUP_ROUTES = ['/groups/discover', '/groups/?category=create'];

  function isGroupProfileHref(href) {
    const value = String(href || '');
    if (!value) return false;
    for (let i = 0; i < NON_PROFILE_GROUP_ROUTES.length; i += 1) {
      if (value.indexOf(NON_PROFILE_GROUP_ROUTES[i]) !== -1) return false;
    }
    return true;
  }

  const LABEL_SELECTOR = 'h2, h3, h4, h5, [role="heading"], div[role="button"], button, a[role="link"], span[role="button"]';

  const OWN_UI_CLASS_PREFIX = 'fb-diet-';

  const GROUP_WORDS = wordList('SUGGESTED_GROUP');

  /** True when the node is inside extension-rendered UI (container excluded). */
  function isInsideOwnUi(el, container) {
    let cur = el;
    while (cur && cur !== container) {
      if (hasClassPrefix(cur)) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function hasClassPrefix(el) {
    const cls = (el && (el.className || (el.getAttribute && el.getAttribute('class')))) || '';
    return typeof cls === 'string' && cls.indexOf(OWN_UI_CLASS_PREFIX) !== -1;
  }

  /** Group wording is a phrase: substring rule. */
  function matchGroupWord(text) {
    const value = (text || '').trim().toLowerCase();
    if (!value) return null;
    for (const word of GROUP_WORDS) {
      if (value.indexOf(word) !== -1) return word;
    }
    return null;
  }

  /** Count links on the unit's own surface only. */
  function countSurfaceLinks(container, selector) {
    const out = { count: 0, distinct: 0, sample: null };
    const seenHrefs = [];
    const nodes = container.querySelectorAll(selector);
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      if (isInsideOwnUi(el, container)) continue;
      if (!isTraySurfaceMarker(el, container)) continue;
      out.count += 1;
      const href = (el.getAttribute && el.getAttribute('href')) || '';
      if (href && seenHrefs.indexOf(href) === -1) {
        seenHrefs.push(href);
        out.distinct += 1;
      }
      if (!out.sample) out.sample = href;
    }
    return out;
  }

  function readSurfaceLabels(container) {
    const out = { reels: null, stories: null, group: null };
    const nodes = container.querySelectorAll(LABEL_SELECTOR);
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      if (isInsideOwnUi(el, container)) continue;
      if (!isTraySurfaceMarker(el, container)) continue;
      // Quoted-post pill is not the unit's own header. // per STRATEGY.md §4
      if (isInsideNestedReshare(el, container)) continue;
      const text = (el.textContent || '').trim();
      const aria = ((el.getAttribute && el.getAttribute('aria-label')) || '').trim();
      if (!out.reels && (isReelsSurfaceLabel(text) || isReelsSurfaceLabel(aria))) out.reels = aria || text;
      if (!out.stories && (isStoriesSurfaceLabel(text) || isStoriesSurfaceLabel(aria))) out.stories = aria || text;
      if (!out.group) out.group = matchGroupWord(aria) || matchGroupWord(text);
      if (out.reels && out.stories && out.group) break;
    }
    return out;
  }

  /** Tray region's own accessible name. */
  function readTrayRegionName(container) {
    const region = container.querySelector('[role="region"]');
    if (!region || isInsideOwnUi(region, container)) return '';
    if (!isTraySurfaceMarker(region, container)) return '';
    return (region.getAttribute('aria-label') || '').trim();
  }

  /** Read surface evidence; `declined` names the no-decision reason. */
  function readSurface(container) {
    const read = {
      tray: null,
      labels: { reels: null, stories: null, group: null },
      links: { reels: 0, stories: 0, groups: 0 },
      samples: { reelsHref: null, storiesHref: null, regionName: null },
      category: null,
      reason: null,
      evidence: null,
      declined: null
    };
    if (!container || typeof container.querySelectorAll !== 'function') {
      read.declined = 'no_container';
      return read;
    }

    const trayMarker = findStructuralTray(container);
    const tray = trayMarker ? trayMarker.kind : null;
    const regionName = readTrayRegionName(container);
    const labels = readSurfaceLabels(container);
    const reelsLinks = countSurfaceLinks(container, REELS_LINK_SELECTOR);
    // Behind the tray gate only: a lone ring is not a tray row.
    const storiesLinks = tray
      ? countSurfaceLinks(container, STORIES_LINK_SELECTOR)
      : { count: 0, distinct: 0, sample: null };

    const groupLabel = labels.group || matchGroupWord(regionName);

    read.tray = tray;
    read.labels = { reels: labels.reels, stories: labels.stories, group: groupLabel };
    read.links = { reels: reelsLinks.count, stories: storiesLinks.count, groups: trayMarker ? trayMarker.groupLinks : 0 };
    read.samples = { reelsHref: reelsLinks.sample, storiesHref: storiesLinks.sample, regionName: regionName };

    const reelsEvidence = Boolean(labels.reels) || reelsLinks.count > 0;
    const storiesEvidence = Boolean(labels.stories) || storiesLinks.distinct >= 2;
    const groupEvidence = Boolean(groupLabel);
    const matches = (reelsEvidence ? 1 : 0) + (storiesEvidence ? 1 : 0) + (groupEvidence ? 1 : 0);

    // Ambiguity fails open; missed fold is cheaper. // per STRATEGY.md §4
    if (matches !== 1) {
      read.declined = matches === 0 ? 'no_surface_evidence' : 'ambiguous_surface';
      return read;
    }

    if (groupEvidence) {
      // Only the tray form is decided.
      if (!tray) {
        read.declined = 'group_without_tray';
        return read;
      }
      read.category = 'suggestedGroup';
      read.reason = 'dom:group_tray';
      read.evidence = groupLabel;
      return read;
    }

    const isReels = reelsEvidence;
    const label = isReels ? labels.reels : labels.stories;
    const links = isReels ? reelsLinks.count : storiesLinks.count;
    const category = isReels ? 'reels' : 'stories';

    if (tray) {
      // Label + 1 link decides; link-only needs a distinct pair.
      if (label) {
        read.category = category;
        read.reason = 'dom:' + category + '_tray_label';
        read.evidence = label;
        return read;
      }
      const distinct = isReels ? reelsLinks.distinct : storiesLinks.distinct;
      if (distinct >= 2) {
        read.category = category;
        read.reason = 'dom:' + category + '_tray_link';
        read.evidence = distinct + ' link(s)';
        return read;
      }
      read.declined = 'single_tray_link';
      return read;
    }

    // Outside a tray only label+link together decides.
    if (label && links > 0) {
      read.category = category;
      read.reason = 'dom:' + category + '_pill_link';
      read.evidence = label;
      return read;
    }
    read.declined = 'standalone_needs_label_and_link';
    return read;
  }

  /** Name the surface, or null. Fail open. */
  function detectSurface(container) {
    try {
      const read = readSurface(container);
      if (!read.category) return null;
      return {
        isSurface: true,
        category: read.category,
        reason: read.reason,
        text: read.evidence,
        debug: {
          tray: read.tray,
          labels: read.labels,
          links: read.links
        }
      };
    } catch (e) {
      // Fail open: a broken scan must never fold a unit.
      return null;
    }
  }

  /** Diagnostic block for hits and declines (same contract as sibling detectors). */
  function explainSurface(container) {
    const base = {
      scanned: false,
      outcome: 'not_scanned',
      outcomeReason: null,
      tray: null,
      labels: null,
      links: null,
      category: null,
      regionName: null,
      sampleHref: null
    };
    if (!container || typeof container.querySelectorAll !== 'function') {
      base.outcomeReason = 'no_container';
      return base;
    }
    base.scanned = true;

    try {
      const read = readSurface(container);
      base.tray = read.tray;
      base.labels = read.labels;
      base.links = read.links;
      base.regionName = truncate(read.samples && read.samples.regionName);
      base.sampleHref = truncate((read.samples && (read.samples.reelsHref || read.samples.storiesHref)) || null);
      base.category = read.category;
      if (read.category) {
        base.outcome = 'detected';
        base.outcomeReason = read.reason;
      } else {
        base.outcome = 'declined';
        base.outcomeReason = read.declined;
      }
      return base;
    } catch (e) {
      base.outcome = 'scan_error';
      base.outcomeReason = String(e && e.message ? e.message : e);
      return base;
    }
  }

  /** Cap names for reports. */
  function truncate(value) {
    const text = typeof value === 'string' ? value : '';
    if (!text) return null;
    return text.length > 40 ? text.slice(0, 40) + '…' : text;
  }

  return {
    isReelsSurfaceLabel,
    isStoriesSurfaceLabel,
    isContentSurfaceLabel,
    isTraySurfaceMarker,
    isHorizontalTray,
    trayVetoFor,
    isInsideNestedReshare,
    detect: detectSurface,
    explain: explainSurface
  };
})();
