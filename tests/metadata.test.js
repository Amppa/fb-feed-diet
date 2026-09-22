'use strict';
const { Checker, createWindow, loadInject } = require('./harness');

function run(c) {
  const classifyResultOf = (ids) => ({ evidence: { ids } });
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
    c.equals('permalink from wwwURL', e.content.permalink, 'https://www.facebook.com/1001/posts/999');
    c.equals('message truncated to snippet', e.content.message.length, 120);
    c.equals('media count', e.media.count, 2);
    c.equals('multi image flag', e.media.isMultiImage, true);
    c.equals('viewer id', e.viewer.id, 'me1');
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
}

module.exports = { run };
