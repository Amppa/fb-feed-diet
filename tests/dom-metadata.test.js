'use strict';
/** Contract tests for the MAIN-world DOM metadata collector. */
const { createWindow, loadInject } = require('./harness');

function makeNode(tag, attrs = {}, children = [], text = '') {
  const node = {
    tagName: tag.toUpperCase(),
    attributes: Object.assign({}, attrs),
    href: attrs.href,
    children: [],
    parentElement: null,
    textContent: text,
    getAttribute(name) { return this.attributes[name] === undefined ? null : this.attributes[name]; },
    matches(selector) {
      const parts = selector.match(/^([a-zA-Z0-9-]+)?(\[[^\]]+\])$/);
      if (parts) {
        if (parts[1] && parts[1].toUpperCase() !== this.tagName) return false;
        const attrMatch = parts[2].match(/^\[([^\]=*]+)(?:\*?=)?(.*)\]$/);
        if (attrMatch) {
          const name = attrMatch[1];
          const value = attrMatch[2] === undefined ? null : attrMatch[2].replace(/^["']|["']$/g, '');
          if (value === null) return this.attributes[name] !== undefined;
          return this.attributes[name] && this.attributes[name].indexOf(value) !== -1;
        }
      }
      return selector.toUpperCase() === this.tagName;
    },
    closest(selector) {
      let current = this;
      while (current) {
        if (current.matches(selector)) return current;
        current = current.parentElement;
      }
      return null;
    },
    contains(other) {
      let current = other;
      while (current) {
        if (current === this) return true;
        current = current.parentElement;
      }
      return false;
    },
    querySelectorAll(selector) {
      const selectors = selector.split(',').map((part) => part.trim());
      const result = [];
      const walk = (parent) => {
        for (const child of parent.children) {
          if (selectors.some((part) => child.matches(part)) && result.indexOf(child) === -1) result.push(child);
          walk(child);
        }
      };
      walk(this);
      return result;
    },
    querySelector(selector) {
      const result = this.querySelectorAll(selector);
      return result.length ? result[0] : null;
    }
  };
  for (const child of children) {
    if (child) {
      child.parentElement = node;
      node.children.push(child);
    }
  }
  if (!text && node.children.length) node.textContent = node.children.map((child) => child.textContent).join(' ');
  return node;
}

function run(c) {
  const win = createWindow();
  loadInject(win, 'ui.js');
  const metadata = win.FBDietDOMMetadata;

  c.ok('DOM metadata API is exposed', Boolean(metadata) && typeof metadata.collect === 'function');
  c.equals('null container returns null', metadata.collect(null), null);
  c.equals('object without querySelector returns null', metadata.collect({}), null);

  const author = makeNode('a', { role: 'link' }, [], 'Ada Lovelace');
  const heading = makeNode('h3', { role: 'heading' }, [author]);
  const group = makeNode('a', { href: '/groups/engineering' }, [], 'Engineering Group');
  const post = makeNode('a', { href: '/posts/123' }, [], 'permalink');
  const ad = makeNode('a', { href: '/ads/about/ad-1' }, [], 'ad details');
  const message = makeNode('div', { 'data-ad-preview': 'message' }, [], 'First line\nSecond line');
  const image = makeNode('img', { src: 'https://fbcdn.example/photo.jpg' });
  const card = makeNode('article', {}, [heading, group, post, ad, message, image]);

  const snapshot = metadata.collect(card, false);
  c.equals('collector returns actor', snapshot && snapshot.actor, 'Ada Lovelace');
  c.equals('collector returns first message line', snapshot && snapshot.snippet, 'First line');
  c.equals('collector returns group', snapshot && snapshot.group, 'Engineering Group');
  c.equals('collector returns post URL', snapshot && snapshot.postUrl, 'https://www.facebook.com/posts/123');
  c.equals('collector returns ad URL', snapshot && snapshot.adUrl, '/ads/about/ad-1');
  c.equals('collector returns single image label', snapshot && snapshot.media, '[📷 相片]');
  c.ok('urls object is present', Boolean(snapshot && snapshot.urls));
  c.equals('urls.domPermalink extracted', snapshot && snapshot.urls && snapshot.urls.domPermalink, 'https://www.facebook.com/posts/123');

  const videoCard = makeNode('article', {}, [makeNode('video')]);
  c.equals('collector returns video label', metadata.collect(videoCard, false).media, '[🎬 影片]');
  const mediaGroupSnapshot = metadata.collect(card, true);
  c.equals('media groups suppress photo labels', mediaGroupSnapshot.media, null);
  c.equals('media groups bypass actor extraction', mediaGroupSnapshot.actor, null);
  c.equals('media groups bypass snippet extraction', mediaGroupSnapshot.snippet, null);
  c.equals('media groups bypass candidate scanning', mediaGroupSnapshot.textCandidates.length, 0);

  // Multi-image test with +2 overlay (3 imgs + 2 = 5 total)
  const img1 = makeNode('img', { src: 'https://fbcdn.example/p1.jpg' });
  const img2 = makeNode('img', { src: 'https://fbcdn.example/p2.jpg' });
  const img3 = makeNode('img', { src: 'https://fbcdn.example/p3.jpg' });
  const plusOverlay = makeNode('span', {}, [], '+2');
  const multiCard = makeNode('article', {}, [img1, img2, img3, plusOverlay]);
  const multiSnapshot = metadata.collect(multiCard, false);
  c.equals('collector formats multi image with xN', multiSnapshot && multiSnapshot.media, '[📷 相片 x5]');

  // Suggested post with section heading "為你推薦" before author heading
  const recHeading = makeNode('h3', {}, [], '為你推薦');
  const realAuthorLink = makeNode('a', { role: 'link' }, [], 'Grace Hopper');
  const authorHeading = makeNode('h4', { role: 'heading' }, [realAuthorLink]);
  const followLink = makeNode('a', { role: 'link' }, [], '追蹤');
  const timeSpan = makeNode('span', { dir: 'auto' }, [], '12 小時');
  const postMsgSpan = makeNode('span', { dir: 'auto' }, [], 'Compilers are amazing\nSecond line');
  const suggestedCard = makeNode('article', {}, [recHeading, authorHeading, followLink, timeSpan, postMsgSpan]);

  const suggestedSnapshot = metadata.collect(suggestedCard, false);
  c.equals('skips 為你推薦 and extracts real author', suggestedSnapshot && suggestedSnapshot.actor, 'Grace Hopper');
  c.equals('skips timestamp and extracts post message from span[dir=auto]', suggestedSnapshot && suggestedSnapshot.snippet, 'Compilers are amazing');
  c.ok('textCandidates is array', Array.isArray(suggestedSnapshot && suggestedSnapshot.textCandidates));
  c.ok('candidate text truncated to <= 30 chars', suggestedSnapshot.textCandidates.every((item) => item.text.length <= 30));

  // Group post with title only + photo + Facebook in footer (the user reported issue)
  const groupHeader = makeNode('a', { href: '/groups/1752413238230321/' }, [], '拾荒');
  const authorInGroup = makeNode('a', { role: 'link', href: '/user/helper' }, [], '拾荒小幫手');
  const authorH = makeNode('h3', { role: 'heading' }, [authorInGroup]);
  const permalinkLink = makeNode('a', { href: '/groups/1752413238230321/permalink/5361557787315830/?fbclid=IwAR123' }, [], '1 小時');
  const postTitleH2 = makeNode('h2', { dir: 'auto' }, [], '二手實木餐桌');
  const photo = makeNode('img', { src: 'https://fbcdn.example/table.jpg' });
  const fbFooter = makeNode('span', { dir: 'auto' }, [], 'Facebook');
  const titleOnlyCard = makeNode('article', {}, [groupHeader, authorH, permalinkLink, postTitleH2, photo, fbFooter]);

  const titleOnlySnapshot = metadata.collect(titleOnlyCard, false);
  c.equals('extracts real author not group name', titleOnlySnapshot && titleOnlySnapshot.actor, '拾荒小幫手');
  c.equals('extracts group name from group link', titleOnlySnapshot && titleOnlySnapshot.group, '拾荒');
  c.equals('extracts clean group permalink URL', titleOnlySnapshot && titleOnlySnapshot.postUrl, 'https://www.facebook.com/groups/1752413238230321/permalink/5361557787315830/');
  c.equals('urls.raw preserves tracking params', titleOnlySnapshot && titleOnlySnapshot.urls && titleOnlySnapshot.urls.raw, 'https://www.facebook.com/groups/1752413238230321/permalink/5361557787315830/?fbclid=IwAR123');
  c.equals('extracts post title when post has only title', titleOnlySnapshot && titleOnlySnapshot.snippet, '二手實木餐桌');

  // Group post with both title AND body text
  const postTitle2 = makeNode('h2', { dir: 'auto' }, [], '【贈送】電磁爐');
  const postBody2 = makeNode('div', { dir: 'auto' }, [], '功能正常，需自取\n意者請私訊');
  const titleAndBodyCard = makeNode('article', {}, [groupHeader, authorH, permalinkLink, postTitle2, postBody2]);

  const titleAndBodySnapshot = metadata.collect(titleAndBodyCard, false);
  c.equals('extracts title + first line when both exist', titleAndBodySnapshot && titleAndBodySnapshot.snippet, '【贈送】電磁爐 功能正常，需自取');

  // Post with title using role="heading"
  const roleHeadingTitle = makeNode('div', { role: 'heading', dir: 'auto' }, [], '免費贈送嬰兒床');
  const titleRoleCard = makeNode('article', {}, [authorH, roleHeadingTitle]);
  const titleRoleSnapshot = metadata.collect(titleRoleCard, false);
  c.equals('extracts title using role="heading"', titleRoleSnapshot && titleRoleSnapshot.snippet, '免費贈送嬰兒床');

  // Suggested post with author heading containing follow button (user reported case)
  const vgraphsAuthor = makeNode('a', { role: 'link', href: '/stories/103822751765571/' }, [], 'VGraphs');
  const vgraphsFollow = makeNode('span', { role: 'button' }, [], '· 追蹤');
  const vgraphsHeading = makeNode('h4', { role: 'heading' }, [vgraphsAuthor, vgraphsFollow]);
  const vgraphsBody = makeNode('span', { dir: 'auto' }, [], '25 代表性的歐洲動畫。  · 查看原文  · 為此翻譯評分');
  const vgraphsCard = makeNode('article', {}, [vgraphsHeading, vgraphsBody]);

  const vgraphsSnapshot = metadata.collect(vgraphsCard, false);
  c.equals('vgraphs actor extracted', vgraphsSnapshot && vgraphsSnapshot.actor, 'VGraphs');
  c.equals('vgraphs heading not misclassified as post title', vgraphsSnapshot && vgraphsSnapshot.title, null);
  c.equals('vgraphs snippet strips duplicate author, follow button, and translation footer', vgraphsSnapshot && vgraphsSnapshot.snippet, '25 代表性的歐洲動畫。');
  const acceptedBody = vgraphsSnapshot.textCandidates.find((item) => item.status === 'accepted:post-body');
  c.ok('vgraphs accepted post body is the message', Boolean(acceptedBody) && acceptedBody.text.indexOf('25 代表性的歐洲動畫') !== -1);
  const titleCand = vgraphsSnapshot.textCandidates.find((item) => item.status === 'accepted:post-title');
  c.equals('no fake post-title candidate', titleCand, undefined);

  // Group post with member profile link + hashtag + long message (>80 chars) + external domain (Costco Rosa Chiou bug)
  const costcoGroupLink = makeNode('a', { href: '/groups/2469367233335424/' }, [], 'COSTCO 好市多 商品消費心得分享區');
  const groupH4 = makeNode('h4', { role: 'heading' }, [costcoGroupLink]);
  const rosaUserLink = makeNode('a', { role: 'link', href: '/groups/2469367233335424/user/1000012345678/?__cft__[0]=AZ' }, [], 'Rosa  Chiou');
  const authorH5 = makeNode('h5', { role: 'heading' }, [rosaUserLink]);
  const hashtagLink = makeNode('a', { role: 'link', href: '/hashtag/hardbite' }, [], '#Hardbite芒果哈瓦那辣椒口味洋芋片');
  const longPostMessage = '#Hardbite芒果哈瓦那辣椒口味洋芋片推薦大家可以買來吃吃，之前是請代購買它們家其他口味超小一包就超貴，現在好市多進了而且很大包！';
  const postMsgDiv = makeNode('div', { dir: 'auto' }, [hashtagLink], longPostMessage);
  const externalLinkSpan = makeNode('span', { dir: 'auto' }, [], 'xNBoy.com');
  const photoWithAlt = makeNode('img', { src: 'https://fbcdn.example/chips.jpg', alt: 'Rosa  Chiou 貼文的相片' });
  const rootHomeLink = makeNode('a', { href: '/?__cft__[0]=AZ' }, [], 'Facebook');

  const costcoCard = makeNode('article', {}, [rootHomeLink, groupH4, authorH5, postMsgDiv, externalLinkSpan, photoWithAlt]);
  const costcoSnapshot = metadata.collect(costcoCard, false);

  c.equals('Costco post actor is Rosa Chiou', costcoSnapshot && costcoSnapshot.actor, 'Rosa Chiou');
  c.equals('Costco post group is correct', costcoSnapshot && costcoSnapshot.group, 'COSTCO 好市多 商品消費心得分享區');
  c.ok('Costco post snippet is post message not xNBoy.com', costcoSnapshot && costcoSnapshot.snippet && costcoSnapshot.snippet.indexOf('#Hardbite') !== -1 && costcoSnapshot.snippet.indexOf('xNBoy.com') === -1);
  c.ok('Costco author profile url points to user not root', costcoSnapshot && costcoSnapshot.urls && costcoSnapshot.urls.authorProfile && costcoSnapshot.urls.authorProfile.indexOf('/user/1000012345678') !== -1);
}

module.exports = { run };
