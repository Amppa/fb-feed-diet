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

  const MESSAGE_SNIPPET = 120;
  const URL_MAX_LEN = 1000;

  function relayApi() {
    const relay = typeof window !== 'undefined' ? window.FBDietRelay : null;
    return relay && typeof relay.readFirst === 'function' ? relay : null;
  }

  function readProp(object, path) {
    let current = object;
    for (const part of String(path).split('.')) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  }

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
      const system = ['profile.php', 'groups', 'pages', 'watch', 'reel', 'stories', 'story.php', 'share', 'events'];
      if (system.indexOf(first) === -1) {
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

  function collect(classifyResult, props) {
    try {
      const relay = relayApi();
      const evidence = classifyResult && classifyResult.evidence;
      const ids = (evidence && (evidence.ids || (evidence.id ? [evidence.id] : null))) ||
        (classifyResult && classifyResult.unitId ? [classifyResult.unitId] : null);

      const payload = props && props.payload;
      const feedUnit = payload && payload.feedUnit;
      const record =
        (payload && (payload.feedUnit || payload.unit || payload.story)) ||
        (payload && payload.edge && payload.edge.node) ||
        (payload && payload.feedEdge && payload.feedEdge.node) ||
        (props && (props.feedUnit || props.unit)) ||
        payload ||
        null;

      // 1. Actor: props first, then Relay store
      const actorObj =
        readProp(record, 'actors.0') ||
        readProp(record, 'actor') ||
        readProp(record, 'comet_sections.header.story.actors.0') ||
        readProp(record, 'comet_sections.content.story.actors.0') ||
        readProp(record, 'story.actors.0') ||
        null;

      const actorName = clean(firstNonEmpty([
        readProp(actorObj, 'name'),
        readProp(record, 'actors.0.name'),
        readPath(ids, ['^^actors[0].name', 'actors[0].name'])
      ]));
      const actorType = clean(firstNonEmpty([
        readProp(actorObj, '__typename'),
        readProp(record, 'actors.0.__typename'),
        readPath(ids, ['^^actors[0].__typename', 'actors[0].__typename'])
      ]));
      const actorSub = clean(firstNonEmpty([
        readProp(actorObj, 'subscribe_status'),
        readProp(record, 'actors.0.subscribe_status'),
        readPath(ids, ['^^actors[0].subscribe_status', 'actors[0].subscribe_status'])
      ]));
      const actorUrl = cleanUrl(firstNonEmpty([
        readProp(actorObj, 'url'),
        readProp(record, 'actors.0.url'),
        readPath(ids, ['^^actors[0].url', 'actors[0].url'])
      ]));
      const rawId = clean(firstNonEmpty([
        readProp(actorObj, 'id'),
        readProp(record, 'actors.0.id'),
        readPath(ids, ['^^actors[0].id', 'actors[0].id'])
      ]));
      const username = clean(firstNonEmpty([
        readProp(actorObj, 'username'),
        readProp(actorObj, 'vanity'),
        extractUsername(actorUrl),
        extractUsername(readPath(ids, ['^^actors[0].url']))
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

      // 2. Group: props first, then Relay store
      const toObj = readProp(record, 'to') || null;
      const groupId = clean(firstNonEmpty([readProp(toObj, 'id'), readPath(ids, ['^to.id'])]));
      const groupPermalink = cleanUrl(firstNonEmpty([
        readProp(toObj, 'wwwURL'),
        readProp(toObj, 'permalink_url'),
        readProp(toObj, 'url'),
        readPath(ids, ['^to.wwwURL', '^to.permalink_url', '^to.url'])
      ]));
      const group = {
        id: groupId,
        name: clean(firstNonEmpty([readProp(toObj, 'name'), readPath(ids, ['^to.name'])])),
        joinState: clean(firstNonEmpty([readProp(toObj, 'viewer_forum_join_state'), readPath(ids, ['^to.viewer_forum_join_state'])])),
        permalink: groupPermalink
      };

      // 3. Post ID & Permalink: props first, then Relay, then compose fallback
      const postId = clean(firstNonEmpty([
        readProp(feedUnit, 'post_id'),
        readProp(feedUnit, 'clip_id'),
        readProp(feedUnit, 'story.post_id'),
        readProp(feedUnit, 'mf_story_key'),
        readProp(record, 'post_id'),
        readProp(record, 'clip_id'),
        readProp(record, 'story.post_id'),
        readProp(record, 'mf_story_key'),
        readProp(payload, 'post_id')
      ]));

      let permalink = cleanUrl(firstNonEmpty([
        readProp(record, 'wwwURL'),
        readProp(record, 'permalink_url'),
        readProp(record, 'url'),
        readProp(record, 'story.url'),
        readProp(record, 'story.wwwURL'),
        readProp(record, 'story.permalink_url'),
        readProp(record, 'comet_sections.content.story.wwwURL'),
        readProp(record, 'comet_sections.feedback.story.url'),
        readProp(record, 'comet_sections.content.story.url'),
        readProp(record, 'feedback_context.feedback_target_with_context.url'),
        readProp(record, 'shareable.url'),
        readProp(payload, 'story.url'),
        readProp(payload, 'story.wwwURL'),
        readPath(ids, ['^wwwURL', '^permalink_url', '^url', '^story.url'])
      ]));

      if (!permalink && postId) {
        const actorHandle = username || rawId;
        if (actorHandle) {
          permalink = 'https://www.facebook.com/' + actorHandle + '/posts/' + postId;
        }
      }

      let title = clean(evidence && evidence.storyTitle);
      if (!title && relay && ids && ids.length) {
        const locations = ['homepage_stream', 'groups_tab', 'feed'];
        for (const loc of locations) {
          try {
            const val = relay.readFirst(ids, '^story_header{$1}.^title.text', { $1: { location: loc } });
            if (val) {
              title = clean(val);
              break;
            }
          } catch (e) {}
        }
      }

      const rawCreatedTime = clean(firstNonEmpty([
        readProp(record, 'created_time'),
        readProp(record, 'creation_time'),
        readProp(record, 'story.created_time'),
        readProp(record, 'publish_time'),
        readPath(ids, ['^created_time'])
      ]));

      const callToAction = clean(firstNonEmpty([
        readProp(record, 'call_to_action.type'),
        readPath(ids, ['^call_to_action.type', '^action_links[0].title', '^action_links[0].text'])
      ]));

      const feedContext = clean(firstNonEmpty([
        readProp(record, 'feed_context.text'),
        readProp(record, 'context_layout.text'),
        readPath(ids, ['^feed_context.text', '^context_layout.text', '^story_header.title.text'])
      ]));

      const isReshare = Boolean(
        readProp(record, 'attached_story') ||
        readProp(record, 'reshared_story') ||
        readPath(ids, ['^attached_story', '^reshared_story'])
      );

      const content = {
        permalink,
        message: clean(firstNonEmpty([
          readProp(record, 'message.text'),
          readProp(record, 'story.message.text'),
          readProp(record, 'comet_sections.content.story.message.text'),
          readPath(ids, ['^message.text'])
        ])),
        title,
        createdTime: rawCreatedTime,
        createdAt: formatCreatedAt(rawCreatedTime),
        callToAction,
        feedContext,
        isReshare
      };

      const recordAttachments = readProp(record, 'attachments');
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

  return { collect };
})();