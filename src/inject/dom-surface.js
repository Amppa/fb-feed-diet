/**
 * FB Diet - mounted-DOM surface module (MAIN world)
 *
 * Two jobs, one concept: reading *what kind of surface a feed unit is* from the markup alone.
 *
 * The first half is the shared vocabulary — the tray marker and the two ancestry walks. Two
 * detectors need those answers and they need them to agree:
 *   - `dom-suggested.js` uses the tray negatively: a horizontal tray is not a recommendation
 *     candidate (STRATEGY.md, misclassification 8);
 *   - the classifier below uses it positively: a Reels tray IS a Reels surface.
 * One copy is the point. Two implementations would drift the moment Facebook renames a tray, and
 * the failure would be invisible: one detector keeps vetoing while the other stops detecting.
 *
 * The second half decides `reels`, `stories` and `suggestedGroup` from that vocabulary. The DOM
 * has always seen these surfaces — the first DOM-only field report read an H3 that said "Reel" on
 * a unit the pipeline then called a regular post, because no rule existed to spend the evidence.
 * `fold.js` consults it only in the DOM-only pipeline, so the daily modes keep deciding these
 * three from the Relay store.
 *
 * The surface vocabulary is read from `FB_DIET_DEFAULTS.KEYWORDS`, so the multilingual word list
 * stays in defaults.js, the single source for that kind of value.
 *
 * Public API (window.FBDietDOMSurface):
 *   isReelsSurfaceLabel(value)         -> boolean
 *   isStoriesSurfaceLabel(value)       -> boolean
 *   isContentSurfaceLabel(value)       -> boolean (either surface)
 *   isTraySurfaceMarker(el, container) -> boolean
 *   isHorizontalTray(container)        -> 'hscroll_child' | 'tray_region' | 'stories_link' | null
 *   isInsideNestedReshare(el, root)    -> boolean
 *   detect(container)                  -> { isSurface, category, reason, text, debug } | null
 *   explain(container)                 -> named-outcome diagnostic block (hits and declines)
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

  /**
   * True when a candidate's own text or aria names a content surface (Reel / Story) rather than a
   * relationship action. Exact match on the whole string, never substring: a post genuinely titled
   * "Reels of my week" is not what this is for, and "story" inside "storytime" must not be excluded.
   *
   * This rule exists because a Reels tile draws its "Reel" pill exactly where a follow button
   * would sit, and the suggested detector's extra-button rule read it as a recommendation cue —
   * field report 2026-09-28, reason `dom:other_extra_button` on a video the store already called
   * reels (STRATEGY.md, misclassification 8).
   */
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

  /**
   * True when the marker is the unit's own surface rather than something the unit happens to contain.
   *
   * A tray tile *is* the horizontal thing: the marker sits on the tile, wrapping its header and its
   * content. A widget buried in a post is a different thing entirely, and it is the post's child,
   * not the post. The boundary that separates them is the post's own content region — its message
   * body, its attachment, or a quoted post nested inside it. So the walk is upwards from the marker
   * to the unit, and anything below one of those boundaries is somebody else's content.
   *
   * This is deliberately its own walk rather than a widened `isInsideNestedReshare`. That function
   * answers "is this element part of a quoted post", which is a narrower question with a different
   * blast radius; widening it to cover message bodies would change what the pre-message label scan
   * considers nested, for a tray rule. Same vocabulary, different question, separate function.
   */
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

  /**
   * True when the unit is part of a horizontal tray rather than a standalone feed post.
   *
   * This is the structural form of the surface answer, and it is the one to trust. Facebook marks
   * every tile of a Reels / Stories tray with `data-type="hscroll-child"` — its own name for a
   * horizontal-scroll child, captured from a real page on 2026-09-28. The other two markers below
   * come from that same capture: the tray region carries `aria-label="動態消息中的限時動態"` and
   * every tile links to `/stories/…`.
   *
   * Structure beats text here. A label rule has to enumerate every language Facebook ships, and a
   * tray that renames itself ("Reel" → "Clip") silently becomes a false positive again. `data-type`
   * is a key in Facebook's own source, not a rendered string, so it survives both a translation
   * change and a design change.
   *
   * The `/stories/` route is the weakest signal and is handled last, and it is now counted rather
   * than merely present. A story RING — the badge Facebook draws around the avatar of any author
   * with a live story — is exactly one `a[href*="/stories/"]` on the unit's own header. A stories
   * TRAY is a row of tiles, each linking to its own story. "A ring is one link; a tray is a row
   * of tiles" is the same sentence the decision path below is built on, and the veto is asked the
   * same question, so it now applies the same discriminator.
   *
   * This reverses part of decision #41, deliberately. That decision narrowed the *decision* path
   * for exactly this shape and left the *veto* path on the bare link, reasoning that a false tray
   * there costs one missed fold rather than a wrong fold. The cost model was right about the
   * direction — the Golden Rule does prefer a missed fold — but it under-counted the frequency: a
   * story ring is drawn on any post by an author with a live story, which is most posts in an
   * active feed, and the veto does not merely decline the unit, it suppresses the cue that would
   * have classified it. Two `dom`-mode reports an hour apart on 2026-09-29 each read
   * `outcome: "vetoed_as_tray", outcomeReason: "stories_link", cues: []` beside
   * `dataEngine: { category: "suggested" }` — the Follow button in the byline was never read. The
   * threshold is 3, the same margin and the same reasoning as `MIN_GROUP_TRAY_LINKS`.
   *
   * It is also only a `[role="region"]`-less tray that reaches this route at all; a tray carrying
   * `data-type="hscroll-child"` was already caught structurally above.
   */
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

  /**
   * The tray a unit may be *declined* for, or null.
   *
   * `isHorizontalTray` answers a structural question — does this container have the shape of a tray.
   * The suggested detector asks a different one: is that shape enough to suppress every cue it would
   * otherwise read. The two came apart on 2026-09-30. A post in a joinable group carries four distinct
   * group profile links on its own surface, which clears `MIN_GROUP_TRAY_LINKS`, so `groups_carousel`
   * came back as a tray and the unit was vetoed with `cues: []` while the store called the same unit
   * `suggested` on `to.viewer_forum_join_state: CAN_JOIN`. The surface rules read the *same* marker and
   * declined it for want of the group wording, so the two detectors disagreed about a single fact and
   * the veto was the half that lost the unit.
   *
   * The discriminator cannot be quantity: four group chips on a post and fifteen cards on a tray are
   * the same count to this rule. It is the naming half of the pair decision #43 already demands of the
   * surface rules — "pairing is the guard (one half alone never decides)". A `groups_carousel` marker
   * vetoes only when the group wording is present too, read by the same call the surface rule pairs it
   * with, so the two can no longer come apart.
   *
   * The other three markers are untouched, and the asymmetry is deliberate. `hscroll_child`,
   * `tray_region` and `stories_link` each name an element that `isTraySurfaceMarker` has already proven
   * to be the unit's own surface. That is a fact about one node; `groups_carousel` is a tally spread
   * over the whole container, and a tally is the only one of the four that can be satisfied by a post
   * that is not a tray.
   */
  function trayVetoFor(container) {
    const kind = isHorizontalTray(container);
    if (kind !== 'groups_carousel') return kind;
    const labels = readSurfaceLabels(container);
    const groupLabel = labels.group || matchGroupWord(readTrayRegionName(container));
    return groupLabel ? kind : null;
  }

  /**
   * The tray *element* a surface decision may rest on, or null: the horizontal-scroll marker or the
   * tray region that names itself after a content surface. Narrower than `isHorizontalTray`, which
   * also accepts a lone `/stories/` link.
   *
   * The asymmetry is about what a wrong answer costs, not about the signal. `dom-suggested.js` spends
   * a tray only to decline, so a false tray was taken to buy back one missed suggested fold. **That
   * reasoning held only while a store verdict stood behind the veto**: a unit declined as a tray fell
   * through to the store, and the store's `suggested` decided it anyway. The modes are exclusive now,
   * and in `dom` mode a vetoed unit becomes `dom:no-verdict` and is never re-read, so a false tray no
   * longer costs one fold — it costs the unit, permanently. `trayVetoFor` below is where that changed
   * claim is cashed in; this function now answers only the structural question.
   *
   * The surface rules spend the same marker to *fold*, and on 2026-09-28 two field reports showed what
   * a false one there earns: an author with a live story wears a story ring on the avatar in the unit's
   * own header — one `a[href*="/stories/"]`, on the unit's own surface, passing every own-surface test
   * — and the unit was decided `dom:stories_tray_link` while the store called it a regular post and a
   * suggested page. A ring is one link; a tray is a row of tiles. Neither is proved by the other, so the
   * decision path takes the structural marker and counts story links only inside it.
   *
   * A marker found deep inside the unit does not count, and this is the correction a real page
   * forced on 2026-09-28. `querySelector` on the unit matches at any depth, and the first field
   * report showed a friend's photo post (26 photos, an ordinary feed unit) being vetoed as a tray
   * because a comment or attachment deep inside it contained a carousel. Facebook marks far more
   * than just feed trays with `hscroll-child`; the attribute means "this thing scrolls sideways",
   * not "this thing is a Reels tray". So a marker only counts when it is the unit's own surface:
   * either the unit itself, or something between the unit and the author header that no message
   * body, attachment or quoted post stands between. Nesting is the signal, and the existing
   * `isInsideNestedReshare` walk already knows how to recognise it.
   *
   * Returns the marker element together with the name of the shape that produced it, or null. The
   * kind is a first-class part of the answer because the group tray has no marker element of its
   * own: it is recognised by counting (see `countGroupCarouselLinks`), so the only thing that can
   * be handed back is the unit itself plus the name of the reason it qualified.
   */
  function findStructuralTray(container) {
    try {
      const hscroll = container.querySelector('[data-type="hscroll-child"]');
      if (hscroll && isTraySurfaceMarker(hscroll, container)) return { el: hscroll, kind: 'hscroll_child', groupLinks: 0 };
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

  /**
   * Distinct hrefs matching `selector` on the unit's own surface, our own UI excluded.
   *
   * Shared by the group carousel and the stories fallback because both answer the same question —
   * "is this a ROW of these, or one of them?" — and both need the same two exclusions plus the
   * same de-duplication. One card links its photo and its title to the same profile; one tile links
   * its thumbnail and its caption to the same story. A raw count would let a single card clear a
   * threshold of three, which is the failure a count is supposed to rule out.
   */
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

  /**
   * A row of group cards, counted rather than matched.
   *
   * The two markers above are what a Reels or Stories tray carries, and the "你的社團建議" tray
   * carries neither: its tiles are plain `<li>` in a `<ul>`, its carousel is a bare
   * `<div aria-label="為你推薦">`, and its arrows are absolutely-positioned divs. On 2026-09-29 that
   * left `findStructuralTray` returning null for the real tray, the surface rules declined it, and
   * the suggested detector — which can only veto a tray it can see — fell through to its own
   * `aria_keyword` on that very same 為你推薦 and folded the whole tray as a recommendation, while
   * the store called it `suggestedGroup`. A tray of fifteen cards folding as one recommendation is
   * the worst shape this class of error takes: it hides fifteen posts behind a single badge.
   *
   * What the tray does have is repetition — several distinct group profiles on the unit's own
   * surface. Counting is the honest reading of that, and it is what the Reels rule already does
   * with `/reel/` links. The threshold is the part that matters and it sits far from both sides: a
   * post inside a group links that group once, the captured tray had fifteen distinct profiles. The
   * count is of DISTINCT hrefs because one card links both its photo and its title to the same
   * profile and would otherwise be counted twice — which is exactly the shape that would let a
   * two-card tray cross a threshold of three.
   */
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

  /* ------------------------------------------------------------------ *
   * Positive surface classification
   *
   * The rules above answer "is this unit a tray", and `dom-suggested.js` has always thrown that
   * answer away after using it to veto a recommendation. This section answers the other half of
   * the same question — *which* surface — so the DOM-only pipeline can decide `reels`, `stories`
   * and `suggestedGroup` from the page. Those three are exactly the categories the data engine
   * derives from Relay typenames (`ShowcaseFeedUnit` / `DiscoverFeedUnit` /
   * `GroupsYouShouldJoinFeedUnit`), which is why a DOM-only mode without these rules reported
   * every Reels tile as a regular post (field report 2026-09-28: `dom:no-verdict` on a unit whose
   * own H3 said "Reel").
   *
   * Nothing here claims authority over the data engine: `fold.js` consults the answer only in
   * `dom` mode, so `relay` keeps deciding these three from the store.
   * ------------------------------------------------------------------ */

  // Link routes Facebook owns. `story_fbid=` is deliberately NOT one of them: it marks ordinary
  // photo permalinks too (defaults.js lists it under post paths), so treating it as a Story marker
  // would fold friend photos as Stories.
  const REELS_LINK_SELECTOR = 'a[href*="/reels/"], a[href*="/reel/"]';
  const STORIES_LINK_SELECTOR = 'a[href*="/stories/"]';
  // Group profile links, and the count that separates a tray of groups from a post in one. See
  // `countGroupCarouselLinks` for why this is a count and why the threshold is where it is.
  const GROUP_PROFILE_LINK_SELECTOR = 'a[href*="/groups/"]';
  const MIN_GROUP_TRAY_LINKS = 3;
  // A story ring is one link; a stories tray is a row of tiles. Same threshold, same margin and
  // same reasoning as the group rule — see `isHorizontalTray` for why the veto now counts.
  const MIN_STORY_TRAY_LINKS = 3;
  // The tray's own chrome links are not group cards. `/groups/discover/` ("查看更多社團") and
  // `/groups/?category=create` ("建立社團") both sit under /groups/, so counting them would let a
  // unit with two real group links clear a threshold of three on the strength of its own
  // "see more groups" button. The threshold is spent on cards only.
  const NON_PROFILE_GROUP_ROUTES = ['/groups/discover', '/groups/?category=create'];

  function isGroupProfileHref(href) {
    const value = String(href || '');
    if (!value) return false;
    for (let i = 0; i < NON_PROFILE_GROUP_ROUTES.length; i += 1) {
      if (value.indexOf(NON_PROFILE_GROUP_ROUTES[i]) !== -1) return false;
    }
    return true;
  }

  // Label-shaped nodes: the author-row pill and the heading a tray region titles itself with. Same
  // heading selector `dom-suggested.js` already resolves, plus the button/link shapes a pill is
  // rendered as. Simple selectors only — the module must stay readable by the Node harness, and a
  // descendant or `:has()` combinator would be silently unsupported rather than loudly wrong.
  const LABEL_SELECTOR = 'h2, h3, h4, h5, [role="heading"], div[role="button"], button, a[role="link"], span[role="button"]';

  // The class prefix every node this extension renders carries, so a detector can tell its own
  // output apart from Facebook's page. See `isInsideOwnUi` for why the walk has to be the rule.
  const OWN_UI_CLASS_PREFIX = 'fb-diet-';

  const GROUP_WORDS = wordList('SUGGESTED_GROUP');

  /**
   * True when the node is, or is nested inside, something this extension rendered.
   *
   * The walk has to be the rule, not the node's own class: a probe popup row is a plain `div` with
   * an `a[href*="/reel/"]` inside it, and the popup is attached to the tree the scanner is handed.
   * Reading our own permalink back as page evidence would fold a unit on top of its own report —
   * self-confirming, and invisible in a field report because the evidence looks real.
   *
   * The container is excluded on purpose. `fold.js` hands the scanner the wrapper *it* mounted
   * (`fb-diet-full-container` and friends), so treating the container's own class as a mark of
   * extension UI would flag every node in the feed as ours and leave the detector reporting nothing
   * on every real page. Only what sits between a node and that wrapper is ours.
   */
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

  /** Group suggestions are named by a phrase, not a single word, so this is a substring rule. */
  function matchGroupWord(text) {
    const value = (text || '').trim().toLowerCase();
    if (!value) return null;
    for (const word of GROUP_WORDS) {
      if (value.indexOf(word) !== -1) return word;
    }
    return null;
  }

  /**
   * Count links Facebook itself would follow, keeping the unit's own surface only. `withinEl`
   * confines the count to one subtree, which is how a story ring stays out of a tray's evidence.
   */
  function countSurfaceLinks(container, selector, withinEl) {
    const out = { count: 0, sample: null };
    const nodes = container.querySelectorAll(selector);
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      if (isInsideOwnUi(el, container)) continue;
      // A /reels/ link inside the message body or a quoted post is content the unit displays, not
      // the unit's own surface — the same correction pitfall 9 forced on the tray marker.
      if (!isTraySurfaceMarker(el, container)) continue;
      if (withinEl && !isWithin(el, withinEl)) continue;
      out.count += 1;
      if (!out.sample) out.sample = el.getAttribute('href') || '';
    }
    return out;
  }

  /** Own walk rather than `contains`, which this repo's Node DOM fake does not implement. */
  function isWithin(el, ancestor) {
    let cur = el;
    while (cur) {
      if (cur === ancestor) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function readSurfaceLabels(container) {
    const out = { reels: null, stories: null, group: null };
    const nodes = container.querySelectorAll(LABEL_SELECTOR);
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i];
      if (isInsideOwnUi(el, container)) continue;
      // A label only counts on the unit's own surface, exactly as the tray marker does. The two
      // selectors walk the whole subtree, and a comment or a reaction list is inside that subtree:
      // without this, one hyperlink whose text is exactly "Reel" would name the whole unit.
      if (!isTraySurfaceMarker(el, container)) continue;
      // A friend's share of a reel puts a "Reel" pill inside the quoted post. That is the reshare
      // case the data engine guards with its own-typename rule (misclassification 3), and the DOM
      // equivalent is to only ever read the unit's own header.
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

  /**
   * The tray region's own accessible name, which is where a horizontal section announces itself
   * ("動態消息中的限時動態", "Groups you might like"). `isHorizontalTray` already reads it to decide
   * whether the unit is a tray; this reads it again to decide which one.
   */
  function readTrayRegionName(container) {
    const region = container.querySelector('[role="region"]');
    if (!region || isInsideOwnUi(region, container)) return '';
    if (!isTraySurfaceMarker(region, container)) return '';
    return (region.getAttribute('aria-label') || '').trim();
  }

  /**
   * Reads one unit's surface evidence and applies the rules. `declined` names why a unit was not
   * decided, so a field report can tell "no evidence on the page" from "evidence, and not enough".
   */
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
    const trayEl = trayMarker ? trayMarker.el : null;
    const regionName = readTrayRegionName(container);
    const labels = readSurfaceLabels(container);
    const reelsLinks = countSurfaceLinks(container, REELS_LINK_SELECTOR);
    // A /stories/ link counts only inside the tray it would be evidence *for*. Held anywhere else on
    // the unit's own surface it is the author's story ring, and a ring says the poster has a live
    // story, not that this unit is a row of story tiles (see `findStructuralTray`).
    const storiesLinks = trayEl
      ? countSurfaceLinks(container, STORIES_LINK_SELECTOR, trayEl)
      : { count: 0, sample: null };

    // A group tray names itself in the region label rather than in a per-tile pill, so the region
    // is a first-class place to look for the group wording.
    const groupLabel = labels.group || matchGroupWord(regionName);

    read.tray = tray;
    read.labels = { reels: labels.reels, stories: labels.stories, group: groupLabel };
    read.links = { reels: reelsLinks.count, stories: storiesLinks.count, groups: trayMarker ? trayMarker.groupLinks : 0 };
    read.samples = { reelsHref: reelsLinks.sample, storiesHref: storiesLinks.sample, regionName: regionName };

    const reelsEvidence = Boolean(labels.reels) || reelsLinks.count > 0;
    const storiesEvidence = Boolean(labels.stories) || storiesLinks.count > 0;
    const groupEvidence = Boolean(groupLabel);
    const matches = (reelsEvidence ? 1 : 0) + (storiesEvidence ? 1 : 0) + (groupEvidence ? 1 : 0);

    // Two surfaces claiming the same unit is a markup ambiguity, not a tie to break. Guessing would
    // fold an ordinary post, and a missed fold is the cheaper error (STRATEGY.md, Golden Rule).
    if (matches !== 1) {
      read.declined = matches === 0 ? 'no_surface_evidence' : 'ambiguous_surface';
      return read;
    }

    if (groupEvidence) {
      // Only the tray form is decided. A vertical list of group suggestions carries no structure
      // that a shared-group post does not also carry.
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
      read.category = category;
      read.reason = label ? 'dom:' + category + '_tray_label' : 'dom:' + category + '_tray_link';
      read.evidence = label || links + ' link(s)';
      return read;
    }

    // Outside a tray, a pill alone or a link alone is not enough: a "Reel" label can be a byline in
    // an ordinary post, and a /reels/ link can be something the poster typed. Both together is the
    // standalone Reel, and that is the only non-tray shape decided here.
    if (label && links > 0) {
      read.category = category;
      read.reason = 'dom:' + category + '_pill_link';
      read.evidence = label;
      return read;
    }
    read.declined = 'standalone_needs_label_and_link';
    return read;
  }

  /**
   * Scans one feed unit's mounted DOM and names its surface. Returns null when the markup does not
   * say, which is the answer for an ordinary post and for every ambiguous case.
   */
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

  /**
   * Why the surface classifier answered the way it did, on hits and on declines alike — the same
   * contract `dom-sponsored.js` and `dom-suggested.js` keep, because a rule that fires is only half
   * of a diagnostic mode. The counts and the shortest few names are what show up when Facebook
   * renames a surface, which is the failure this mode exists to catch before a user reports a feed
   * that quietly stopped folding.
   *
   * `tray` here is the structural tray the decision used. A unit whose only tray-shaped signal is a
   * lone `/stories/` link therefore reads `tray: null` in this block while the suggested block beside
   * it reports `vetoed_as_tray`, and that is the true story: the weak signal was spent on a decline,
   * not on a fold.
   */
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

  /** Reports keep a name, not a paragraph: a region label can hold a whole sentence. */
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
