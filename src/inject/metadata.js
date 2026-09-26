/**
 * FB Diet - Feed metadata collector (MAIN world)
 *
 * Gathers user-facing context about a feed unit for the probe report: author,
 * group, content (message / permalink / created time), media attributes and the
 * viewer. Everything is best-effort and null-safe: the exact Relay field layout
 * differs across surfaces and experiments, so missing values simply stay null.
 *
 * This is the Phase B foundation (STRATEGY.md, decisions #8/#10): before adding
 * relationship rules (followed page / joined group / friend vs stranger), the
 * probe must surface the real field values first.
 *
 * Public API (window.FBDietMetadata):
 *   collect(classifyResult, props) -> enrichment object | null
 */
window.FBDietMetadata = (() => {
  'use strict';

  // defaults.js is always injected before this module (manifest.json content_scripts),
  // so the shared path reader and reserved-route table can be taken directly.
  const DEFAULTS = window.FB_DIET_DEFAULTS || globalThis.FB_DIET_DEFAULTS || {};
  const RESERVED_PROFILE_SEGMENTS = DEFAULTS.RESERVED_PROFILE_SEGMENTS || [];

  const MESSAGE_SNIPPET = 120;
  const URL_MAX_LEN = 1000;

  function relayApi() {
    const relay = typeof window !== 'undefined' ? window.FBDietRelay : null;
    return relay && typeof relay.readFirst === 'function' ? relay : null;
  }

  const readProp = DEFAULTS.readProp;

  function firstNonEmpty(candidates) {
    for (const value of candidates) {
      if (value !== null && value !== undefined && value !== '') return value;
    }
    return null;
  }

  /** Reads candidate paths through the Relay reader; the first non-null wins. */
  function readPath(ids, paths) {
    const relay = relayApi();
    if (!relay || !ids || !ids.length) return null;
    for (const path of paths) {
      try {
        const value = relay.readFirst(ids, path);
        if (value !== null && value !== undefined && value !== '') return value;
      } catch (e) {
        // A missing field must never break the report
      }
    }
    return null;
  }

  /** Only primitives survive into the report; long strings get truncated. */
  function clean(value, maxLen = MESSAGE_SNIPPET) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value.length > maxLen ? value.slice(0, maxLen) : value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    return null;
  }

  /** Preserves full URLs up to URL_MAX_LEN and normalizes relative paths. */
  function cleanUrl(value) {
    if (typeof value !== 'string' || !value) return null;
    const trimmed = value.trim();
    if (trimmed.startsWith('/')) return 'https://www.facebook.com' + trimmed;
    if (trimmed.length > URL_MAX_LEN) return trimmed.slice(0, URL_MAX_LEN);
    return trimmed;
  }

  /** Extracts Facebook username or vanity slug from a profile or page URL. */
  function extractUsername(url) {
    if (typeof url !== 'string' || !url) return null;
    try {
      const path = url.replace(/^https?:\/\/[^\/]+/i, '').replace(/\?.*$/, '').replace(/\/+$/, '');
      const parts = path.split('/').filter(Boolean);
      if (!parts.length) return null;
      const first = parts[0];
      // Same reserved-route table ui.js uses to gate vanity-handle synthesis: refusing
      // Facebook routes here keeps a #hashtag or /photos path from surfacing as an author.
      if (RESERVED_PROFILE_SEGMENTS.indexOf(first.toLowerCase()) === -1) {
        return first;
      }
    } catch (e) {}
    return null;
  }

  function formatCreatedAt(ts) {
    if (ts === null || ts === undefined) return null;
    const num = typeof ts === 'number' ? ts : Number(ts);
    if (isNaN(num) || num <= 0) return null;
    const ms = num < 1e11 ? num * 1000 : num;
    try {
      return new Date(ms).toISOString();
    } catch (e) {
      return null;
    }
  }

  /** Best-effort attachment count: arrays, {__refs}, {count} or numeric fields. */
  function attachmentCount(value) {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object') {
      if (Array.isArray(value.__refs)) return value.__refs.length;
      if (typeof value.count === 'number') return value.count;
    }
    if (typeof value === 'number') return value;
    return null;
  }

  function collectMedia(record) {
    const media = { count: null, types: null, isMultiImage: null, hasVideo: null };
    try {
      if (record && typeof record === 'object') {
        media.count = clean(firstNonEmpty([attachmentCount(record.attachments), attachmentCount(record.all_subattachments), record.attachments_count]));
        if (Array.isArray(record.attachments)) {
          const types = record.attachments
            .map((attachment) => (attachment && attachment.__typename ? attachment.__typename : null))
            .filter(Boolean);
          if (types.length) media.types = Array.from(new Set(types));
        }
      }
      media.isMultiImage = typeof media.count === 'number' ? media.count > 1 : null;
      media.hasVideo = Array.isArray(media.types)
        ? media.types.some((type) => typeof type === 'string' && type.indexOf('Video') !== -1)
        : null;
    } catch (e) {
      // Metadata must never throw
    }
    return media;
  }

  /**
   * Recursively traverses a React element or prop tree to extract candidate Story/Unit records.
   * Traverses through Context.Providers, Fragment wrappers, and rendered element trees.
   */
  function extractCandidateRecords(roots) {
    const candidates = [];
    const visited = new Set();
    const MAX_DEPTH = 20;

    function isRecordLike(obj) {
      if (!obj || typeof obj !== 'object') return false;
      return Boolean(
        obj.comet_sections ||
        (Array.isArray(obj.actors) && obj.actors.length > 0) ||
        obj.actor ||
        obj.author ||
        obj.headline ||
        obj.title ||
        obj.action_links ||
        obj.call_to_action ||
        obj.story_header ||
        obj.sponsored_data ||
        obj.th_dat_spo ||
        obj.is_sponsored !== undefined ||
        obj.viewer_forum_join_state !== undefined ||
        obj.viewer_join_state !== undefined ||
        obj.message ||
        obj.post_id ||
        obj.permalink_url ||
        obj.url
      );
    }

    function scan(node, depth) {
      if (!node || depth > MAX_DEPTH || typeof node !== 'object') return;
      if (visited.has(node)) return;
      visited.add(node);

      if (isRecordLike(node)) {
        candidates.push(node);
      }
      if (node.story && typeof node.story === 'object') scan(node.story, depth + 1);
      if (node.feedUnit && typeof node.feedUnit === 'object') scan(node.feedUnit, depth + 1);
      if (node.unit && typeof node.unit === 'object') scan(node.unit, depth + 1);
      if (node.edge && typeof node.edge === 'object') {
        scan(node.edge, depth + 1);
        if (node.edge.node && typeof node.edge.node === 'object') scan(node.edge.node, depth + 1);
      }
      if (node.feedEdge && typeof node.feedEdge === 'object') {
        scan(node.feedEdge, depth + 1);
        if (node.feedEdge.node && typeof node.feedEdge.node === 'object') scan(node.feedEdge.node, depth + 1);
      }
      if (node.node && typeof node.node === 'object') scan(node.node, depth + 1);
      if (node.header && typeof node.header === 'object') scan(node.header, depth + 1);
      if (node.content && typeof node.content === 'object') scan(node.content, depth + 1);

      if (node.props && typeof node.props === 'object') {
        scan(node.props, depth + 1);
      }
      if (node.value && typeof node.value === 'object') {
        scan(node.value, depth + 1);
      }
      if (node.children) {
        if (Array.isArray(node.children)) {
          for (let i = 0; i < Math.min(node.children.length, 12); i++) {
            scan(node.children[i], depth + 1);
          }
        } else {
          scan(node.children, depth + 1);
        }
      }
    }

    for (const root of roots) {
      if (root) scan(root, 0);
    }
    return candidates;
  }

  /**
   * Actor block: props/records first, then the Relay store.
   * Also returns the raw id and vanity username because permalink composition needs them.
   */
  function collectActor(ctx) {
    const actorObj =
      ctx.readFromRecords('actors.0') ||
      ctx.readFromRecords('actor') ||
      ctx.readFromRecords('author') ||
      ctx.readFromRecords('comet_sections.header.story.actors.0') ||
      ctx.readFromRecords('comet_sections.content.story.actors.0') ||
      ctx.readFromRecords('edge.node.comet_sections.header.story.actors.0') ||
      ctx.readFromRecords('node.comet_sections.header.story.actors.0') ||
      ctx.readFromRecords('story.actors.0') ||
      null;

    const actorName = clean(firstNonEmpty([
      readProp(actorObj, 'name'),
      readProp(actorObj, 'text'),
      ctx.readFromRecords('actors.0.name'),
      ctx.readFromRecords('actor.name'),
      ctx.readFromRecords('author.name'),
      ctx.readFromRecords('headline.text'),
      ctx.readFromRecords('comet_sections.header.story.actors.0.name'),
      ctx.readFromRecords('comet_sections.header.story.title.text'),
      ctx.readFromRecords('edge.node.comet_sections.header.story.actors.0.name'),
      ctx.readFromRecords('node.comet_sections.header.story.actors.0.name'),
      ctx.readFromRecords('story.actors.0.name'),
      readPath(ctx.ids, ['^^actors[0].name', 'actors[0].name'])
    ]));
    const actorType = clean(firstNonEmpty([
      readProp(actorObj, '__typename'),
      ctx.readFromRecords('actors.0.__typename'),
      readPath(ctx.ids, ['^^actors[0].__typename', 'actors[0].__typename'])
    ]));
    const actorSub = clean(firstNonEmpty([
      readProp(actorObj, 'subscribe_status'),
      ctx.readFromRecords('actors.0.subscribe_status'),
      readPath(ctx.ids, ['^^actors[0].subscribe_status', 'actors[0].subscribe_status'])
    ]));
    const actorUrl = cleanUrl(firstNonEmpty([
      readProp(actorObj, 'url'),
      ctx.readFromRecords('actors.0.url'),
      readPath(ctx.ids, ['^^actors[0].url', 'actors[0].url'])
    ]));
    const rawId = clean(firstNonEmpty([
      readProp(actorObj, 'id'),
      ctx.readFromRecords('actors.0.id'),
      readPath(ctx.ids, ['^^actors[0].id', 'actors[0].id'])
    ]));
    const username = clean(firstNonEmpty([
      readProp(actorObj, 'username'),
      readProp(actorObj, 'vanity'),
      extractUsername(actorUrl),
      extractUsername(readPath(ctx.ids, ['^^actors[0].url']))
    ]));

    // When vanity username exists, prioritize it as actor id for human recognition
    const actorId = username || rawId || null;
    const actor = {
      id: actorId,
      name: actorName,
      username: username || null,
      typename: actorType,
      subscribeStatus: actorSub,
      url: actorUrl
    };
    if (rawId && rawId !== actorId) {
      actor.numericId = rawId;
    }
    return { actor, username, rawId };
  }

  /** Group block: props/records first, then the Relay store. */
  function collectGroup(ctx) {
    const toObj = ctx.readFromRecords('to') || ctx.readFromRecords('comet_sections.header.story.to') || null;
    return {
      id: clean(firstNonEmpty([readProp(toObj, 'id'), readPath(ctx.ids, ['^to.id'])])),
      name: clean(firstNonEmpty([
        readProp(toObj, 'name'),
        ctx.readFromRecords('to.name'),
        ctx.readFromRecords('comet_sections.header.story.to.name'),
        ctx.readFromRecords('edge.node.comet_sections.header.story.to.name'),
        ctx.readFromRecords('node.comet_sections.header.story.to.name'),
        readPath(ctx.ids, ['^to.name'])
      ])),
      joinState: clean(firstNonEmpty([readProp(toObj, 'viewer_forum_join_state'), readPath(ctx.ids, ['^to.viewer_forum_join_state'])])),
      permalink: cleanUrl(firstNonEmpty([
        readProp(toObj, 'wwwURL'),
        readProp(toObj, 'permalink_url'),
        readProp(toObj, 'url'),
        readPath(ctx.ids, ['^to.wwwURL', '^to.permalink_url', '^to.url'])
      ]))
    };
  }

  /** Content block: post id, permalink (with the handle-composed fallback), title, message. */
  function collectContent(ctx, username, rawId) {
    const postId = clean(firstNonEmpty([
      readProp(ctx.feedUnit, 'post_id'),
      readProp(ctx.feedUnit, 'clip_id'),
      readProp(ctx.feedUnit, 'story.post_id'),
      readProp(ctx.feedUnit, 'mf_story_key'),
      ctx.readFromRecords('post_id'),
      ctx.readFromRecords('clip_id'),
      ctx.readFromRecords('story.post_id'),
      ctx.readFromRecords('mf_story_key'),
      readProp(ctx.payload, 'post_id')
    ]));

    let permalink = cleanUrl(firstNonEmpty([
      ctx.readFromRecords('wwwURL'),
      ctx.readFromRecords('permalink_url'),
      ctx.readFromRecords('url'),
      ctx.readFromRecords('story.url'),
      ctx.readFromRecords('story.wwwURL'),
      ctx.readFromRecords('story.permalink_url'),
      ctx.readFromRecords('sponsored_data.about_this_ad_url'),
      ctx.readFromRecords('comet_sections.header.story.sponsored_data.about_this_ad_url'),
      ctx.readFromRecords('comet_sections.content.story.permalink_url'),
      ctx.readFromRecords('comet_sections.content.story.wwwURL'),
      ctx.readFromRecords('comet_sections.feedback.story.url'),
      ctx.readFromRecords('comet_sections.content.story.url'),
      ctx.readFromRecords('feedback_context.feedback_target_with_context.url'),
      ctx.readFromRecords('shareable.url'),
      readProp(ctx.payload, 'story.url'),
      readProp(ctx.payload, 'story.wwwURL'),
      readPath(ctx.ids, ['^wwwURL', '^permalink_url', '^url', '^story.url', '^sponsored_data.about_this_ad_url'])
    ]));

    if (!permalink && postId) {
      const actorHandle = username || rawId;
      if (actorHandle) {
        permalink = 'https://www.facebook.com/' + actorHandle + '/posts/' + postId;
      }
    }

    let title = clean(firstNonEmpty([
      ctx.readFromRecords('comet_sections.header.story.title.text'),
      ctx.readFromRecords('story_header.title.text'),
      ctx.evidence && ctx.evidence.storyTitle
    ]));
    if (!title && ctx.relay && ctx.ids && ctx.ids.length) {
      const locations = ['homepage_stream', 'groups_tab', 'feed'];
      for (const loc of locations) {
        try {
          const val = ctx.relay.readFirst(ctx.ids, '^story_header{$1}.^title.text', { $1: { location: loc } });
          if (val) {
            title = clean(val);
            break;
          }
        } catch (e) {}
      }
    }

    const rawCreatedTime = clean(firstNonEmpty([
      ctx.readFromRecords('created_time'),
      ctx.readFromRecords('creation_time'),
      ctx.readFromRecords('story.created_time'),
      ctx.readFromRecords('publish_time'),
      readPath(ctx.ids, ['^created_time'])
    ]));

    return {
      permalink,
      message: clean(firstNonEmpty([
        ctx.readFromRecords('message.text'),
        ctx.readFromRecords('story.message.text'),
        ctx.readFromRecords('comet_sections.content.story.message.text'),
        ctx.readFromRecords('edge.node.comet_sections.content.story.message.text'),
        ctx.readFromRecords('node.comet_sections.content.story.message.text'),
        typeof ctx.readFromRecords('message') === 'string' ? ctx.readFromRecords('message') : null,
        typeof ctx.readFromRecords('text') === 'string' ? ctx.readFromRecords('text') : null,
        readPath(ctx.ids, ['^message.text'])
      ])),
      title,
      createdTime: rawCreatedTime,
      createdAt: formatCreatedAt(rawCreatedTime),
      callToAction: clean(firstNonEmpty([
        ctx.readFromRecords('call_to_action.type'),
        ctx.readFromRecords('action_links.0.title'),
        ctx.readFromRecords('action_links.0.text'),
        readPath(ctx.ids, ['^call_to_action.type', '^action_links[0].title', '^action_links[0].text'])
      ])),
      feedContext: clean(firstNonEmpty([
        ctx.readFromRecords('feed_context.text'),
        ctx.readFromRecords('context_layout.text'),
        readPath(ctx.ids, ['^feed_context.text', '^context_layout.text', '^story_header.title.text'])
      ])),
      isReshare: Boolean(
        ctx.readFromRecords('attached_story') ||
        ctx.readFromRecords('reshared_story') ||
        readPath(ctx.ids, ['^attached_story', '^reshared_story'])
      )
    };
  }

  function collect(classifyResult, props) {
    try {
      const relay = relayApi();
      const evidence = classifyResult && classifyResult.evidence;
      const ids = (evidence && (evidence.ids || (evidence.id ? [evidence.id] : null))) ||
        (classifyResult && classifyResult.unitId ? [classifyResult.unitId] : null);

      const payload = props && props.payload;
      const lastCmp = props && props.lastCmp;
      const feedUnit = payload && payload.feedUnit;
      const childrenProps = payload && payload.children && typeof payload.children === 'object'
        ? (payload.children.props || (Array.isArray(payload.children) && payload.children[0] ? payload.children[0].props : null))
        : null;

      const primaryRecord =
        (childrenProps && childrenProps.edge && childrenProps.edge.node) ||
        (childrenProps && childrenProps.edge) ||
        (childrenProps && (childrenProps.feedUnit || childrenProps.unit || childrenProps.story)) ||
        (payload && (payload.feedUnit || payload.unit || payload.story)) ||
        (payload && payload.edge && payload.edge.node) ||
        (payload && payload.feedEdge && payload.feedEdge.node) ||
        (props && (props.feedUnit || props.unit)) ||
        payload ||
        null;

      const candidateRecords = extractCandidateRecords([payload, lastCmp, childrenProps, primaryRecord]);
      const records = [primaryRecord, ...candidateRecords].filter(Boolean);

      function readFromRecords(path) {
        for (const rec of records) {
          const val = readProp(rec, path);
          if (val !== null && val !== undefined && val !== '') return val;
        }
        return null;
      }

      // Every block reads the same candidate set: props/records first, Relay store second.
      const ctx = { readFromRecords, ids, relay, evidence, feedUnit, payload };

      const actorResult = collectActor(ctx);
      const actor = actorResult.actor;
      const username = actorResult.username;
      const rawId = actorResult.rawId;
      const group = collectGroup(ctx);
      const content = collectContent(ctx, username, rawId);

      const recordAttachments = readFromRecords('attachments') || readFromRecords('all_subattachments');
      const relayRecord = relay && typeof relay.describe === 'function' && ids && ids.length ? relay.describe(ids[0]) : null;
      const media = collectMedia(relayRecord || (recordAttachments ? { attachments: recordAttachments } : null));

      let viewer = null;
      try {
        if (relay && typeof relay.describe === 'function') {
          const viewerRecord = relay.describe('viewer');
          if (viewerRecord && typeof viewerRecord === 'object') {
            const viewerId = clean(firstNonEmpty([viewerRecord.actor_id, viewerRecord.id]));
            const isSelf = rawId && viewerId ? rawId === viewerId : null;
            viewer = { isSelf };
          }
        }
      } catch (e) {
        // The viewer record may not exist in this snapshot
      }

      // Return null only if no informative fields were found anywhere
      const hasAnyData = Boolean(
        actor.id || actor.name || actor.url ||
        group.name || group.id ||
        content.permalink || content.message || content.createdTime ||
        (media && media.count !== null)
      );

      if (!hasAnyData) return null;

      return { actor, group, content, media, viewer };
    } catch (e) {
      return null;
    }
  }

  return { collect, extractCandidateRecords };
})();