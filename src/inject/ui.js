/**
 * FB Diet - UI and Placeholder Components (MAIN world)
 *
 * Provides React placeholder bars and group badges. Mounted-DOM metadata extraction is not
 * here: the bar reads it through `window.FBDietDOMMetadata` (`dom-metadata.js`), which is
 * the visual-engine counterpart of `relay-metadata.js`.
 *
 * Public API: window.FBDietUI
 */
window.FBDietUI = (() => {
  'use strict';

  // Same access pattern as the sibling MAIN-world modules (probe.js, dom-suggested.js).
  // Group mapping and badge metadata come from defaults.js; an unknown or
  // unclassified category still resolves to 'regular' so bars never throw.
  const DEFAULTS = window.FB_DIET_DEFAULTS || globalThis.FB_DIET_DEFAULTS || {};
  const GROUP_BY_CATEGORY = DEFAULTS.GROUP_BY_CATEGORY || {};
  const GROUP_META = DEFAULTS.GROUP_META || {};

  function groupOf(category) {
    return GROUP_BY_CATEGORY[category] || 'regular';
  }

  function resolveBadgeText(category) {
    if (typeof DEFAULTS.resolveBadgeText === 'function') {
      return DEFAULTS.resolveBadgeText(category);
    }
    if (category === 'reels') return 'Reels';
    if (category === 'stories') return 'Stories';
    const meta = GROUP_META[groupOf(category)] || GROUP_META.other;
    return meta.badgeText || 'Other';
  }

  function createEl(type, props, children) {
    const comet = window.FBDietComet;
    const React = comet ? comet.getReact() : null;
    if (!React || !type) return null;
    return comet.createElement(React, type, props, children);
  }

  const titleBarCache = new Map();
  // Folded bars stay mounted for the life of the tab (per docs/architecture.md), so an
  // uncapped cache would grow with every unit the user ever scrolls past. Map iteration
  // order gives FIFO eviction for free; a miss just re-runs the scan.
  const TITLE_BAR_CACHE_MAX = 300;
  const TITLE_BAR_SCAN_TIMEOUT_MS = 4000;
  const TITLE_BAR_SCAN_THROTTLE_MS = 200;

  // The custom tooltip is inset from the bar's own box: 20px indent on the left,
  // and 20px inset on the right (width stops 40px short of the bar).
  const TOOLTIP_INDENT_PX = 20;
  // Narrow bars (zoomed layouts) still get a usable popup instead of a sliver.
  const TOOLTIP_MIN_WIDTH_PX = 200;
  // Floating vertical gap between the fold bar bottom and the tooltip top.
  const TOOLTIP_GAP_PX = 6;

  /** Mounted-DOM metadata for one unit, or null when that module is not on the page. */
  function collectDomMetadata(container, isMediaGroup) {
    const domMeta = window.FBDietDOMMetadata;
    if (!domMeta || typeof domMeta.collect !== 'function') return null;
    return domMeta.collect(container, isMediaGroup);
  }

  /** The same module owns the snippet-cleaning rules; without it the raw text stands. */
  function cleanPostSnippet(rawText, author, group, limits) {
    const domMeta = window.FBDietDOMMetadata;
    if (domMeta && typeof domMeta.cleanPostSnippet === 'function') {
      return domMeta.cleanPostSnippet(rawText, author, group, limits);
    }
    return typeof rawText === 'string' ? rawText : '';
  }

  /** Tooltip cleaning limits (10 lines, 200 chars); undefined keeps bar snippet limits. */
  function titleBarTooltipLimits() {
    const domMeta = window.FBDietDOMMetadata;
    return (domMeta && (domMeta.titleBarTooltipLimits || domMeta.tooltipSnippetLimits)) || undefined;
  }

  /**
   * The settings the MAIN world is running with, or null before the bridge is loaded — the feed
   * then renders in the page's own language, which is what it did before a choice could be made.
   */
  function getBridgeSettings() {
    try {
      const bridge = typeof window !== 'undefined' ? window.FBDietBridge : null;
      if (bridge && typeof bridge.getSettings === 'function') return bridge.getSettings();
    } catch (e) {}
    return null;
  }

  /**
   * A feed-surface label in the language the injected UI renders in. Both the words and the locale
   * rule live in the shared constants module — the only file the MAIN world and the extension
   * pages load in common (FEED_LABELS, resolveFeedLocale). `fallback` differs per caller: the
   * collapse tooltip has an English one to fall back to, a media label has none.
   */
  function getFeedLabelFor(key, fallback) {
    try {
      const doc = typeof document !== 'undefined' ? document : (typeof window !== 'undefined' ? window.document : null);
      const nav = typeof navigator !== 'undefined' ? navigator : (typeof window !== 'undefined' ? window.navigator : null);
      if (typeof DEFAULTS.getFeedLabel === 'function') {
        const label = DEFAULTS.getFeedLabel(key, DEFAULTS.resolveFeedLocale(getBridgeSettings(), doc, nav));
        if (label) return label;
      }
    } catch (e) {
      // A page without a document or navigator simply gets the caller's fallback.
    }
    return fallback || '';
  }

  /** The expanded bar's tooltip. */
  function getCollapseLabel() {
    return getFeedLabelFor('collapseBar', 'Collapse');
  }

  /** The bar label for a media surface, or '' when the table has no name for it. */
  function getMediaLabel(category) {
    return getFeedLabelFor(category, '');
  }

  /**
   * Title mode bar (24px single line snippet, permanent across expand/collapse).
   */
  function TitleBar(props) {
    try {
      const meta = GROUP_META[groupOf(props.category)] || GROUP_META.other;
      const isExpanded = Boolean(props.isExpanded);
      const isMini = Boolean(props.isMini);
      const showTitle = props.showTitle !== undefined ? Boolean(props.showTitle) : true;
      const isStaticCategory = props.category === 'reels' || props.category === 'stories' || props.category === 'suggestedGroup';

      const React = window.FBDietComet ? window.FBDietComet.getReact() : null;
      const barRef = React && typeof React.useRef === 'function' ? React.useRef(null) : { current: null };
      const hoverRef = React && typeof React.useRef === 'function' ? React.useRef(null) : { current: null };
      if (hoverRef && !hoverRef.current) hoverRef.current = { node: null, onScroll: null };

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
          // `allowDomScan === false` means Relay-only mode (per docs/architecture.md), which reads
          // the header text from Relay/props only, so it must not attach a subtree scanner or run
          // the DOM suggested detector here. Every other mode mounts a visual engine and may scan.
          if (props.allowDomScan === false) return;
          if (initialActor && initialMsg) return;
          if (cached && cached.actorName && cached.snippetText) return;
          const el = barRef && barRef.current;
          if (!el) return;
          const container = el.nextElementSibling || (el.parentElement ? el.parentElement.querySelector('.fb-diet-fold-hidden, .fb-diet-expand-body, .fb-diet-full-container') : null);
          if (!container) return;

          let observer = null;
          let active = true;
          let suggestedNotified = false;

          const scan = () => {
            if (!active) return false;
            // The fold wrapper stops passing onSuggestedDetected once it has a verdict, but this
            // effect is not re-created for that (deps are unitId / showTitle / isExpanded), so
            // without this flag every later scan would run the DOM detector again and re-notify,
            // re-rendering the unit for a verdict it already has.
            if (!suggestedNotified && props.category === 'regular' && typeof props.onSuggestedDetected === 'function') {
              const detector = window.FBDietDOMSuggested;
              if (detector && typeof detector.detect === 'function') {
                const detected = detector.detect(container);
                if (detected && detected.isSuggested) {
                  suggestedNotified = true;
                  props.onSuggestedDetected(detected);
                }
              }
            }
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
              if (unitId) {
                titleBarCache.set(unitId, newData);
                while (titleBarCache.size > TITLE_BAR_CACHE_MAX) {
                  const oldest = titleBarCache.keys().next();
                  if (oldest.done) break;
                  titleBarCache.delete(oldest.value);
                }
              }
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
          let scanTimer = null;

          // Mutation bursts on a streaming post would otherwise re-run the full subtree
          // sweep per batch, so coalesce them into one scan.
          const scheduleScan = () => {
            if (!active || scanTimer) return;
            scanTimer = setTimeout(() => {
              scanTimer = null;
              scan();
            }, TITLE_BAR_SCAN_THROTTLE_MS);
          };

          if (MutationObs) {
            try {
              observer = new MutationObs(scheduleScan);
              observer.observe(container, { childList: true, subtree: true, characterData: true });
            } catch (e) {}
          }

          const delays = [50, 150, 400, 1000, 2500];
          const timers = delays.map((d) => setTimeout(scan, d));

          // A folded unit is never unmounted, so the effect cleanup below cannot be the
          // only way to stop listening: posts that never reveal a body would otherwise
          // keep a subtree observer for the life of the tab.
          const stopTimer = setTimeout(() => {
            if (observer) {
              try { observer.disconnect(); } catch (e) {}
              observer = null;
            }
          }, TITLE_BAR_SCAN_TIMEOUT_MS);

          return () => {
            active = false;
            if (observer) {
              try { observer.disconnect(); } catch (e) {}
            }
            if (scanTimer) clearTimeout(scanTimer);
            timers.forEach((t) => clearTimeout(t));
            clearTimeout(stopTimer);
          };
        }, [unitId, showTitle, isExpanded, props.allowDomScan]);
      }

      // Unmount cleanup for the custom portal tooltip: a pending timer or a shown
      // node must not outlive the bar. `hideBarTooltip` is declared below and hoisted.
      if (React && typeof React.useEffect === 'function') {
        React.useEffect(() => {
          return () => { hideBarTooltip(); };
        }, []);
      }

      const effectiveActor = (domData && domData.actorName) || initialActor;
      const effectiveMsg = (domData && domData.snippetText) || initialMsg;
      const effectiveGroup = (domData && domData.groupName) || initialGroup;

      const badgeText = resolveBadgeText(props.category);
      const badge = createEl('span', { className: 'fb-diet-badge ' + meta.badgeClass }, [badgeText]);
      const contentKids = [badge];

      // Tooltip source text: folded shows the full post text (the visible snippet
      // is CSS-truncated), expanded offers collapse. Computed once; each tooltip
      // mode below decides whether and how to present it.
      let tooltipText = null;

      if (showTitle) {
        // Group name (with max-width: 140px in css)
        if (effectiveGroup && !isStaticCategory) {
          contentKids.push(
            createEl('span', { className: 'fb-diet-title-group' }, [
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
            createEl('span', { className: authorClass }, [authorText])
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
            createEl('span', { className: 'fb-diet-title-snippet' }, [snippetText])
          );
          if (!isExpanded) {
            tooltipText = (effectiveMsg && cleanPostSnippet(effectiveMsg, effectiveActor, effectiveGroup, titleBarTooltipLimits())) || snippetText;
          }
        }
      }

      if (isExpanded) tooltipText = getCollapseLabel();

      // Tooltip mode: 'off' shows nothing, 'normal'/'large' show the portal
      // popup at 16px/28px. Hover handlers attach only for portal + folded +
      // text — every other combination shows nothing.
      const tooltipMode = (DEFAULTS && typeof DEFAULTS.normalizeTooltipMode === 'function')
        ? DEFAULTS.normalizeTooltipMode(props.tooltipMode)
        : (props.tooltipMode === 'off' || props.tooltipMode === 'normal' || props.tooltipMode === 'large' ? props.tooltipMode : 'large');
      const useCustomTooltip = tooltipMode !== 'off' && !isExpanded && Boolean(tooltipText);
      const tooltipFontPx = (DEFAULTS && typeof DEFAULTS.tooltipFontSizePx === 'function')
        ? DEFAULTS.tooltipFontSizePx(props.tooltipMode)
        : 28;

      /** Removes the portal node and its scroll listener, if any. */
      function hideBarTooltip() {
        try {
          const hover = hoverRef ? hoverRef.current : null;
          if (!hover) return;
          if (hover.onScroll && typeof window !== 'undefined' && window.removeEventListener) {
            try { window.removeEventListener('scroll', hover.onScroll, true); } catch (e) {}
            hover.onScroll = null;
          }
          if (hover.node && hover.node.parentNode && typeof hover.node.parentNode.removeChild === 'function') {
            try { hover.node.parentNode.removeChild(hover.node); } catch (e) {}
            hover.node = null;
          }
        } catch (e) {}
      }

      /** Builds and positions the portal tooltip under the bar, on hover. */
      function showBarTooltip() {
        hideBarTooltip();
        try {
          const barEl = barRef && barRef.current;
          const doc = typeof document !== 'undefined' ? document : (typeof window !== 'undefined' ? window.document : null);
          if (!barEl || typeof barEl.getBoundingClientRect !== 'function') return;
          if (!doc || !doc.body || typeof doc.createElement !== 'function') return;
          const rect = barEl.getBoundingClientRect();
          if (!rect || typeof rect.left !== 'number' || typeof rect.bottom !== 'number') return;
          const node = doc.createElement('div');
          node.className = 'fb-diet-tooltip';
          // textContent only, never HTML: the text is post content.
          node.textContent = tooltipText;
          const width = typeof rect.width === 'number' ? rect.width : 0;
          const maxWidth = Math.max(width - (TOOLTIP_INDENT_PX * 2), TOOLTIP_MIN_WIDTH_PX) + 'px';
          if (node.style && typeof node.style.setProperty === 'function') {
            node.style.setProperty('max-width', maxWidth, 'important');
            node.style.setProperty('font-size', tooltipFontPx + 'px', 'important');
          } else {
            node.style.maxWidth = maxWidth;
            node.style.fontSize = tooltipFontPx + 'px';
          }
          node.style.left = Math.max(rect.left + TOOLTIP_INDENT_PX, 8) + 'px';
          node.style.top = (rect.bottom + TOOLTIP_GAP_PX) + 'px';
          doc.body.appendChild(node);
          const hover = hoverRef ? hoverRef.current : null;
          if (hover) hover.node = node;
          const onScroll = function () { hideBarTooltip(); };
          if (hover) hover.onScroll = onScroll;
          if (typeof window !== 'undefined' && window.addEventListener) {
            try { window.addEventListener('scroll', onScroll, true); } catch (e) {}
          }
        } catch (e) {}
      }

      function handleBarMouseEnter() {
        try {
          const hover = hoverRef ? hoverRef.current : null;
          if (!hover || hover.node) return;
          showBarTooltip();
        } catch (e) {}
      }

      function handleBarClick(event) {
        hideBarTooltip();
        try {
          if (typeof props.onToggle === 'function') props.onToggle(event);
        } catch (e) {}
      }

      const contentBox = createEl('div', { className: 'fb-diet-title-content' }, contentKids);

      let className = 'fb-diet-titlebar';
      if (isMini) className += ' fb-diet-titlebar-mini';
      if (isExpanded) className += ' fb-diet-state-expanded';

      const barProps = {
        ref: barRef,
        className: className,
        onClick: props.onToggle
      };
      if (useCustomTooltip) {
        barProps.onMouseEnter = handleBarMouseEnter;
        barProps.onMouseLeave = hideBarTooltip;
        barProps.onClick = handleBarClick;
      }
      return createEl(
        'div',
        barProps,
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
    TitleBar,
    resolveBadgeText,
    getMediaLabel,
    getCollapseLabel
  };
})();