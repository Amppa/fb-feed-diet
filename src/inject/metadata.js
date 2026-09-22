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

  function relayApi() {
    const relay = typeof window !== 'undefined' ? window.FBDietRelay : null;
    return relay && typeof relay.readFirst === 'function' ? relay : null;
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
  function clean(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value.length > MESSAGE_SNIPPET ? value.slice(0, MESSAGE_SNIPPET) : value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    return null;
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
          if (types.length) media.types = types;
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
      const ids = classifyResult && classifyResult.evidence && classifyResult.evidence.ids;
      const feedUnit = props && props.payload && props.payload.feedUnit;
      if (!relay || !ids || !ids.length) return null;

      const actor = {
        id: clean(readPath(ids, ['^^actors[0].id'])),
        name: clean(readPath(ids, ['^^actors[0].name'])),
        typename: clean(readPath(ids, ['^^actors[0].__typename'])),
        subscribeStatus: clean(readPath(ids, ['^^actors[0].subscribe_status']))
      };

      const group = {
        id: clean(readPath(ids, ['^to.id'])),
        name: clean(readPath(ids, ['^to.name'])),
        typename: clean(readPath(ids, ['^to.__typename'])),
        joinState: clean(readPath(ids, ['^to.viewer_forum_join_state']))
      };

      const postId = clean(feedUnit && feedUnit.post_id);
      let permalink = clean(readPath(ids, ['^wwwURL', '^permalink_url', '^url']));
      if (!permalink && postId && typeof actor.id === 'string' && actor.id) {
        permalink = 'https://www.facebook.com/' + actor.id + '/posts/' + postId;
      }

      const content = {
        permalink,
        post_id: postId,
        message: clean(readPath(ids, ['^message.text'])),
        createdTime: clean(readPath(ids, ['^created_time'])),
        title: clean(classifyResult && classifyResult.evidence && classifyResult.evidence.storyTitle)
      };

      const record = relay && typeof relay.describe === 'function' ? relay.describe(ids[0]) : null;
      const media = collectMedia(record);

      let viewer = null;
      try {
        const viewerRecord = relay.describe('viewer');
        if (viewerRecord && typeof viewerRecord === 'object') {
          viewer = { id: clean(firstNonEmpty([viewerRecord.actor_id, viewerRecord.id])) };
        }
      } catch (e) {
        // The viewer record may not exist in this snapshot
      }

      return { actor, group, content, media, viewer };
    } catch (e) {
      return null;
    }
  }

  return { collect };
})();