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
      const initialActor = (enrichment && enrichment.actor && enrichment.actor.name) || (domData && domData.actorName) || (cached && cached.actorName) || '';
      const initialMsg = (enrichment && enrichment.content && (enrichment.content.message || enrichment.content.title)) || (domData && domData.snippetText) || (cached && cached.snippetText) || '';
      const initialGroup = (enrichment && enrichment.group && enrichment.group.name) || (domData && domData.groupName) || (cached && cached.groupName) || '';

      if (React && typeof React.useEffect === 'function') {
        React.useEffect(() => {
          if (!showTitle) return;
          const isMediaGroup = props.category === 'reels' || props.category === 'stories';
          if (initialActor && (initialMsg || isMediaGroup)) return;
          if (cached && cached.actorName && (cached.snippetText || isMediaGroup)) return;
          const el = barRef && barRef.current;
          if (!el) return;
          const container = el.nextElementSibling || (el.parentElement ? el.parentElement.querySelector('.fb-diet-fold-hidden, .fb-diet-expand-body, .fb-diet-full-container') : null);
          if (!container) return;

          let observer = null;
          let active = true;

          const scan = () => {
            if (!active) return false;
            const domMetadata = window.FBDietDOMMetadata && typeof window.FBDietDOMMetadata.collect === 'function'
              ? window.FBDietDOMMetadata.collect(container, isMediaGroup)
              : null;
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
              if (foundActor && (foundMsg || foundMedia || isMediaGroup)) {
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
    FBDietBar,
    FBDietTitleBar
  };
})();
