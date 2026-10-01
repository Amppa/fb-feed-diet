'use strict';
const { Checker, createWindow, loadInject, loadDefaults } = require('./harness');

function run(c) {
  const classifyResultOf = (ids) => ({ evidence: { id: Array.isArray(ids) ? ids[0] : ids, idCount: Array.isArray(ids) ? ids.length : 1, ids: Array.isArray(ids) ? ids : [ids] } });
  const propsOf = (feedUnit) => ({ payload: { feedUnit } });

  /* --- no relay module on window -> null (never throws) --- */
  {
    const win = createWindow();
    win.FB_DIET_DEFAULTS = loadDefaults();
    loadInject(win, 'relay-metadata.js');
    c.ok('metadata API exposed', Boolean(win.FBDietRelayMetadata) && typeof win.FBDietRelayMetadata.collect === 'function');
    c.equals('collect returns null without FBDietRelay', win.FBDietRelayMetadata.collect(classifyResultOf(['u1']), propsOf({})), null);
  }

  /* --- full enrichment: author / group / content / media / viewer --- */
  {
    const win = createWindow();
    win.FBDietRelay = {
      readFirst(ids, paths) {
        const pathsMap = {
          '^^actors[0].id': '1001',
          '^^actors[0].name': 'Jane Doe',
          '^^actors[0].__typename': 'Page',
          '^^actors[0].subscribe_status': 'CAN_SUBSCRIBE',
          '^to.id': 'g1',
          '^to.name': '測試社團',
          '^to.__typename': 'Group',
          '^to.viewer_forum_join_state': 'CAN_JOIN',
          '^to.permalink_url': 'https://www.facebook.com/groups/g1',
          // Scalar fields are read with the plain path: Relay throws on getLinkedRecord() for a
          // field that is not a link, so the old '^wwwURL' / '^created_time' never resolved.
          'wwwURL': 'https://www.facebook.com/1001/posts/999',
          '^message.text': 'x'.repeat(200),
          'created_time': 1700000000
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
    win.FB_DIET_DEFAULTS = loadDefaults();
    loadInject(win, 'relay-metadata.js');
    const e = win.FBDietRelayMetadata.collect(classifyResultOf(['u1']), propsOf({ post_id: '999', __typename: 'Story', __id: 'u1' }));
    c.ok('enrichment collected', Boolean(e));
    c.equals('actor name', e.actor.name, 'Jane Doe');
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
    win.FB_DIET_DEFAULTS = loadDefaults();
    loadInject(win, 'relay-metadata.js');
    const e = win.FBDietRelayMetadata.collect(classifyResultOf(['u1']), propsOf({}));
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
    win.FB_DIET_DEFAULTS = loadDefaults();
    loadInject(win, 'relay-metadata.js');
    const e = win.FBDietRelayMetadata.collect(classifyResultOf(['u1']), propsOf({ post_id: '999' }));
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
    win.FB_DIET_DEFAULTS = loadDefaults();
    loadInject(win, 'relay-metadata.js');
    const e = win.FBDietRelayMetadata.collect(classifyResultOf(['u1']), propsOf({}));
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
    win.FB_DIET_DEFAULTS = loadDefaults();
    loadInject(win, 'relay-metadata.js');
    const e = win.FBDietRelayMetadata.collect(classifyResultOf(['u1']), propsOf({}));
    c.equals('single attachment not multi image', e.media.isMultiImage, false);
    c.equals('video detected', e.media.hasVideo, true);
  }

  /* --- props-first extraction: vanity username, full permalink > 120 chars, no relay --- */
  {
    const win = createWindow();
    // FBDietRelay is null / not loaded
    win.FB_DIET_DEFAULTS = loadDefaults();
    loadInject(win, 'relay-metadata.js');
    const fullPostUrl = 'https://www.facebook.com/samplelearnJapanese/posts/pfbid0SyntheticPostIdForTests000000000000000000000000000000000000000';
    const feedUnit = {
      __typename: 'Story',
      id: 'u-story-japanese',
      wwwURL: fullPostUrl,
      actors: [
        {
          __typename: 'Page',
          id: '100000000000',
          name: '示範日語小站',
          url: 'https://www.facebook.com/samplelearnJapanese',
          subscribe_status: 'IS_SUBSCRIBED'
        }
      ],
      message: { text: '日語單字天天學！' },
      created_time: 1700000123
    };
    const e = win.FBDietRelayMetadata.collect(classifyResultOf(['u-story-japanese']), propsOf(feedUnit));
    c.ok('enrichment collected from props without relay', Boolean(e));
    c.equals('actor id is vanity username', e.actor.id, 'samplelearnJapanese');
    c.equals('actor username extracted from url', e.actor.username, 'samplelearnJapanese');
    c.equals('actor numericId preserved', e.actor.numericId, '100000000000');
    c.equals('actor name extracted', e.actor.name, '示範日語小站');
    c.equals('actor typename extracted', e.actor.typename, 'Page');
    c.equals('actor subscribe status extracted', e.actor.subscribeStatus, 'IS_SUBSCRIBED');
    c.equals('full post URL not truncated at 120 chars', e.content.permalink, fullPostUrl);
    c.equals('content message extracted', e.content.message, '日語單字天天學！');
    c.equals('createdTime raw timestamp preserved', e.content.createdTime, 1700000123);
  }

  /* --- nested Context Provider unwrapping in metadata --- */
  {
    const win = createWindow();
    win.FB_DIET_DEFAULTS = loadDefaults();
    loadInject(win, 'relay-metadata.js');
    const fullPostUrl = 'https://www.facebook.com/samplelearnJapanese/posts/pfbid0SyntheticPostIdForTests000000000000000000000000000000000000000';
    const payload = {
      feedUnit: {
        __typename: 'Story',
        id: 'u-provider-peel',
        __fragments: {}
      },
      children: {
        props: {
          value: { ctx: 'provider1' },
          children: {
            props: {
              value: { ctx: 'provider2' },
              children: {
                props: {
                  story: {
                    id: 's-deep-story',
                    comet_sections: {
                      header: {
                        story: {
                          actors: [
                            {
                              __typename: 'Page',
                              id: '100000000000',
                              name: 'Jane Doe',
                              url: 'https://www.facebook.com/samplelearnJapanese'
                            }
                          ],
                          title: { text: '為你推薦' }
                        }
                      },
                      content: {
                        story: {
                          message: { text: '日語單字解析！' },
                          permalink_url: fullPostUrl
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    };
    const e = win.FBDietRelayMetadata.collect(classifyResultOf(['u-provider-peel']), { payload });
    c.ok('peeled enrichment collected from nested provider', Boolean(e));
    c.equals('peeled actor username extracted', e.actor.username, 'samplelearnJapanese');
    c.equals('peeled actor name extracted', e.actor.name, 'Jane Doe');
    c.equals('peeled permalink extracted', e.content.permalink, fullPostUrl);
    c.equals('peeled message extracted', e.content.message, '日語單字解析！');
    c.equals('peeled title extracted', e.content.title, '為你推薦');
  }

  /* --- edge.node inside children props (GraphQL connection) --- */
  {
    const win = createWindow();
    win.FB_DIET_DEFAULTS = loadDefaults();
    loadInject(win, 'relay-metadata.js');
    const payload = {
      feedUnit: {
        __typename: 'Story',
        post_id: '9300000000000001',
        __id: 'UzpfSUZTOjE6...'
      },
      children: {
        props: {
          edge: {
            node: {
              __typename: 'Story',
              comet_sections: {
                header: {
                  story: {
                    actors: [{ name: '社福之家' }]
                  }
                },
                content: {
                  story: {
                    message: { text: '#月團圓趣味闖關' }
                  }
                }
              }
            }
          }
        }
      }
    };
    const e = win.FBDietRelayMetadata.collect(classifyResultOf(['UzpfSUZTOjE6...']), { payload });
    c.ok('edge.node enrichment collected', Boolean(e));
    c.equals('edge.node actor name extracted', e && e.actor && e.actor.name, '社福之家');
    c.equals('edge.node message text extracted', e && e.content && e.content.message, '#月團圓趣味闖關');
  }
  /* --- scalar Relay fields must never use the linked-record path (Relay throws on it) --- */
  {
    const win = createWindow();
    const asked = [];
    let resolved = false;
    win.FBDietRelay = {
      readFirst(ids, paths) {
        const list = Array.isArray(paths) ? paths : [paths];
        for (const path of list) asked.push(path);
        // While `resolved` is false nothing matches, so readFirst walks the whole candidate
        // list and the assertion below sees every path the collector actually asks for.
        if (!resolved) return null;
        for (const path of list) {
          if (path === 'url') return 'https://www.facebook.com/1001/posts/999';
          if (path === 'created_time') return 1700000000;
        }
        return null;
      },
      describe() {
        return null;
      }
    };
    win.FB_DIET_DEFAULTS = loadDefaults();
    loadInject(win, 'relay-metadata.js');

    win.FBDietRelayMetadata.collect(classifyResultOf(['u1']), propsOf({ post_id: '999' }));
    c.ok('no scalar field is asked for with the linked-record marker',
      asked.indexOf('^url') === -1 && asked.indexOf('^wwwURL') === -1 &&
      asked.indexOf('^permalink_url') === -1 && asked.indexOf('^created_time') === -1);
    c.ok('genuinely linked fields keep their marker', asked.indexOf('^story.url') !== -1);

    resolved = true;
    const e = win.FBDietRelayMetadata.collect(classifyResultOf(['u1']), propsOf({ post_id: '999' }));
    c.equals('scalar url resolves through the plain path', e.content.permalink, 'https://www.facebook.com/1001/posts/999');
    c.equals('scalar created_time resolves through the plain path', e.content.createdTime, 1700000000);
  }
  /* --- every plural link is read with ^^, never with a single-link marker --- */
  {
    const win = createWindow();
    const asked = [];
    win.FBDietRelay = {
      readFirst(ids, paths) {
        const list = Array.isArray(paths) ? paths : [paths];
        for (const path of list) asked.push(path);
        for (const path of list) {
          if (path === '^^action_links[0].title') return '追蹤';
          // Something else to collect, so hasAnyData is satisfied and enrichment is returned.
          if (path === '^^actors[0].name') return 'Jane Doe';
        }
        return null;
      },
      describe() {
        return null;
      }
    };
    win.FB_DIET_DEFAULTS = loadDefaults();
    loadInject(win, 'relay-metadata.js');
    const e = win.FBDietRelayMetadata.collect(classifyResultOf(['u1']), propsOf({}));
    c.equals('action link title resolves through the plural path', e.content.callToAction, '追蹤');

    // A path like '^thing[0]' is a single-link marker on a plural field: always a Relay throw.
    // Checked across every path the collector ever asks for, not just the one fixed here.
    // `^^thing[0]` is the correct plural form and must not match.
    const bad = asked.filter((p) => /(^|[^.\^])\^[a-z_]+\[\d/.test(p));
    c.equals('no path uses a single-link marker on an indexed plural field', bad.length, 0);
  }


  /* --- a plural link must never be read with the value or singular accessor (invariant #696) --- */
  {
    const win = createWindow();
    const asked = [];
    win.FBDietRelay = {
      readFirst(ids, paths) {
        const list = Array.isArray(paths) ? paths : [paths];
        for (const path of list) asked.push(path);
        for (const path of list) {
          if (path === '^^actors[0].name') return 'Jane Doe';
          if (path === '^^actors[0].subscribe_status') return 'CAN_SUBSCRIBE';
        }
        return null;
      },
      describe() {
        return null;
      }
    };
    win.FB_DIET_DEFAULTS = loadDefaults();
    loadInject(win, 'relay-metadata.js');
    const e = win.FBDietRelayMetadata.collect(classifyResultOf(['u1']), propsOf({}));

    c.equals('actor name still resolves through the plural path', e.actor.name, 'Jane Doe');
    c.equals('subscribe status still resolves through the plural path', e.actor.subscribeStatus, 'CAN_SUBSCRIBE');
    c.ok('no plural field is asked for with the value marker',
      asked.every((p) => p.indexOf('actors[0]') === -1 || p.indexOf('^^actors[0]') === 0));
    // A singular read of a plural field would be a path starting with '^actors' but not '^^actors'.
    c.ok('no plural field is asked for with the singular marker',
      asked.every((p) => p.indexOf('^actors') !== 0));
  }
}

module.exports = { run };
