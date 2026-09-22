'use strict';
const { Checker, createWindow, loadInject } = require('./harness');

function run(c) {
  const classifyResultOf = (ids) => ({ evidence: { id: Array.isArray(ids) ? ids[0] : ids, idCount: Array.isArray(ids) ? ids.length : 1, ids: Array.isArray(ids) ? ids : [ids] } });
  const propsOf = (feedUnit) => ({ payload: { feedUnit } });

  /* --- no relay module on window -> null (never throws) --- */
  {
    const win = createWindow();
    loadInject(win, 'metadata.js');
    c.ok('metadata API exposed', Boolean(win.FBDietMetadata) && typeof win.FBDietMetadata.collect === 'function');
    c.equals('collect returns null without FBDietRelay', win.FBDietMetadata.collect(classifyResultOf(['u1']), propsOf({})), null);
  }

  /* --- full enrichment: author / group / content / media / viewer --- */
  {
    const win = createWindow();
    win.FBDietRelay = {
      readFirst(ids, paths) {
        const pathsMap = {
          '^^actors[0].id': '1001',
          '^^actors[0].name': 'Sunny Lin',
          '^^actors[0].__typename': 'Page',
          '^^actors[0].subscribe_status': 'CAN_SUBSCRIBE',
          '^to.id': 'g1',
          '^to.name': '測試社團',
          '^to.__typename': 'Group',
          '^to.viewer_forum_join_state': 'CAN_JOIN',
          '^to.permalink_url': 'https://www.facebook.com/groups/g1',
          '^wwwURL': 'https://www.facebook.com/1001/posts/999',
          '^message.text': 'x'.repeat(200),
          '^created_time': 1700000000
        };
        const list = Array.isArray(paths) ? paths : [paths];
        for (const path of list) {
          if (pathsMap[path]) return pathsMap[path];
        }
        return null;
      },
      describe(id) {
        if (id === 'u1') return { attachments: [{ __typename: 'Photo' }, { __typename: 'Photo' }] };
        if (id === 'viewer') return { actor_id: 'me1' };
        return null;
      }
    };
    loadInject(win, 'metadata.js');
    const e = win.FBDietMetadata.collect(classifyResultOf(['u1']), propsOf({ post_id: '999', __typename: 'Story', __id: 'u1' }));
    c.ok('enrichment collected', Boolean(e));
    c.equals('actor name', e.actor.name, 'Sunny Lin');
    c.equals('actor typename', e.actor.typename, 'Page');
    c.equals('actor subscribe status', e.actor.subscribeStatus, 'CAN_SUBSCRIBE');
    c.equals('group name', e.group.name, '測試社團');
    c.equals('group join state', e.group.joinState, 'CAN_JOIN');
    c.equals('group permalink', e.group.permalink, 'https://www.facebook.com/groups/g1');
    c.equals('permalink from wwwURL', e.content.permalink, 'https://www.facebook.com/1001/posts/999');
    c.equals('message truncated to snippet', e.content.message.length, 120);
    c.equals('createdTime raw timestamp', e.content.createdTime, 1700000000);
    c.equals('createdAt formatted ISO', e.content.createdAt, '2023-11-14T22:13:20.000Z');
    c.equals('content.post_id not in content', e.content.post_id, undefined);
    c.equals('media count', e.media.count, 2);
    c.equals('multi image flag', e.media.isMultiImage, true);
    c.equals('media types deduplicated', e.media.types.length, 1);
    c.equals('viewer isSelf false when different', e.viewer.isSelf, false);
  }

  /* --- viewer isSelf true when actor matches viewer --- */
  {
    const win = createWindow();
    win.FBDietRelay = {
      readFirst(ids, paths) {
        const list = Array.isArray(paths) ? paths : [paths];
        if (list.indexOf('^^actors[0].id') !== -1) return 'me1';
        return null;
      },
      describe(id) {
        return id === 'viewer' ? { actor_id: 'me1' } : null;
      }
    };
    loadInject(win, 'metadata.js');
    const e = win.FBDietMetadata.collect(classifyResultOf(['u1']), propsOf({}));
    c.equals('viewer isSelf true when matching', e.viewer.isSelf, true);
  }

  /* --- permalink fallback: built from actor id + post_id --- */
  {
    const win = createWindow();
    win.FBDietRelay = {
      readFirst(ids, paths) {
        const list = Array.isArray(paths) ? paths : [paths];
        if (list.indexOf('^^actors[0].id') !== -1) return '1001';
        return null;
      },
      describe() {
        return null;
      }
    };
    loadInject(win, 'metadata.js');
    const e = win.FBDietMetadata.collect(classifyResultOf(['u1']), propsOf({ post_id: '999' }));
    c.equals('permalink constructed from actor + post_id', e.content.permalink, 'https://www.facebook.com/1001/posts/999');
    c.equals('no attachments -> media count null', e.media.count, null);
    c.equals('viewer isSelf null when viewer missing', e.viewer, null);
  }

  /* --- attachments stored as {__refs} --- */
  {
    const win = createWindow();
    win.FBDietRelay = {
      readFirst() {
        return null;
      },
      describe(id) {
        return id === 'u1' ? { attachments: { __refs: ['a', 'b', 'c'] } } : null;
      }
    };
    loadInject(win, 'metadata.js');
    const e = win.FBDietMetadata.collect(classifyResultOf(['u1']), propsOf({}));
    c.equals('__refs attachments counted', e.media.count, 3);
    c.equals('multi image from refs', e.media.isMultiImage, true);
  }

  /* --- video detection --- */
  {
    const win = createWindow();
    win.FBDietRelay = {
      readFirst() {
        return null;
      },
      describe(id) {
        return id === 'u1' ? { attachments: [{ __typename: 'VideoInfo' }] } : null;
      }
    };
    loadInject(win, 'metadata.js');
    const e = win.FBDietMetadata.collect(classifyResultOf(['u1']), propsOf({}));
    c.equals('single attachment not multi image', e.media.isMultiImage, false);
    c.equals('video detected', e.media.hasVideo, true);
  }

  /* --- props-first extraction: vanity username, full permalink > 120 chars, no relay --- */
  {
    const win = createWindow();
    // FBDietRelay is null / not loaded
    loadInject(win, 'metadata.js');
    const fullPostUrl = 'https://www.facebook.com/happylearningJapanese/posts/pfbid0sNZD1f9wqoPLEs85Eq2rwi3DhFYseBe98usBEZr2xr2u6FrtefXgwWRWmfd6CqKkl';
    const feedUnit = {
      __typename: 'Story',
      id: 'u-story-japanese',
      wwwURL: fullPostUrl,
      actors: [
        {
          __typename: 'Page',
          id: '100064245789',
          name: '快樂學日語',
          url: 'https://www.facebook.com/happylearningJapanese',
          subscribe_status: 'IS_SUBSCRIBED'
        }
      ],
      message: { text: '日語單字天天學！' },
      created_time: 1726978432
    };
    const e = win.FBDietMetadata.collect(classifyResultOf(['u-story-japanese']), propsOf(feedUnit));
    c.ok('enrichment collected from props without relay', Boolean(e));
    c.equals('actor id is vanity username', e.actor.id, 'happylearningJapanese');
    c.equals('actor username extracted from url', e.actor.username, 'happylearningJapanese');
    c.equals('actor numericId preserved', e.actor.numericId, '100064245789');
    c.equals('actor name extracted', e.actor.name, '快樂學日語');
    c.equals('actor typename extracted', e.actor.typename, 'Page');
    c.equals('actor subscribe status extracted', e.actor.subscribeStatus, 'IS_SUBSCRIBED');
    c.equals('full post URL not truncated at 120 chars', e.content.permalink, fullPostUrl);
    c.equals('content message extracted', e.content.message, '日語單字天天學！');
    c.equals('createdTime raw timestamp preserved', e.content.createdTime, 1726978432);
  }
}

module.exports = { run };
