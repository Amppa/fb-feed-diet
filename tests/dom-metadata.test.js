'use strict';
/** Contract tests for the MAIN-world DOM metadata collector. */
const { createWindow, loadInject, loadDefaults, makeNode } = require('./harness');

function run(c) {
  const win = createWindow();
  win.FB_DIET_DEFAULTS = loadDefaults();
  loadInject(win, 'dom-metadata.js');
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

  // Group post with title only + photo + Facebook in footer (the user reported issue)
  const groupHeader = makeNode('a', { href: '/groups/9000000000000001/' }, [], '回收社');
  const authorInGroup = makeNode('a', { role: 'link', href: '/user/helper' }, [], '回收社小幫手');
  const authorH = makeNode('h3', { role: 'heading' }, [authorInGroup]);
  const permalinkLink = makeNode('a', { href: '/groups/9000000000000001/permalink/9100000000000001/?fbclid=IwAR123' }, [], '1 小時');
  const postTitleH2 = makeNode('h2', { dir: 'auto' }, [], '二手實木餐桌');
  const photo = makeNode('img', { src: 'https://fbcdn.example/table.jpg' });
  const fbFooter = makeNode('span', { dir: 'auto' }, [], 'Facebook');
  const titleOnlyCard = makeNode('article', {}, [groupHeader, authorH, permalinkLink, postTitleH2, photo, fbFooter]);

  const titleOnlySnapshot = metadata.collect(titleOnlyCard, false);
  c.equals('extracts real author not group name', titleOnlySnapshot && titleOnlySnapshot.actor, '回收社小幫手');
  c.equals('extracts group name from group link', titleOnlySnapshot && titleOnlySnapshot.group, '回收社');
  c.equals('extracts clean group permalink URL', titleOnlySnapshot && titleOnlySnapshot.postUrl, 'https://www.facebook.com/groups/9000000000000001/permalink/9100000000000001/');
  c.equals('urls.raw preserves tracking params', titleOnlySnapshot && titleOnlySnapshot.urls && titleOnlySnapshot.urls.raw, 'https://www.facebook.com/groups/9000000000000001/permalink/9100000000000001/?fbclid=IwAR123');
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
  const vgraphsAuthor = makeNode('a', { role: 'link', href: '/stories/900000000000001/' }, [], 'VistaGraph');
  const vgraphsFollow = makeNode('span', { role: 'button' }, [], '· 追蹤');
  const vgraphsHeading = makeNode('h4', { role: 'heading' }, [vgraphsAuthor, vgraphsFollow]);
  const vgraphsBody = makeNode('span', { dir: 'auto' }, [], '25 代表性的歐洲動畫。  · 查看原文  · 為此翻譯評分');
  const vgraphsCard = makeNode('article', {}, [vgraphsHeading, vgraphsBody]);

  const vgraphsSnapshot = metadata.collect(vgraphsCard, false);
  c.equals('vgraphs actor extracted', vgraphsSnapshot && vgraphsSnapshot.actor, 'VistaGraph');
  c.equals('vgraphs heading not misclassified as post title', vgraphsSnapshot && vgraphsSnapshot.title, null);
  c.equals('vgraphs snippet strips duplicate author, follow button, and translation footer', vgraphsSnapshot && vgraphsSnapshot.snippet, '25 代表性的歐洲動畫。');

  // Group post with member profile link + hashtag + long message (>80 chars) + external domain (Costco Cora Chen bug)
  const costcoGroupLink = makeNode('a', { href: '/groups/9200000000000001/' }, [], '量販店零食交流社團');
  const groupH4 = makeNode('h4', { role: 'heading' }, [costcoGroupLink]);
  const rosaUserLink = makeNode('a', { role: 'link', href: '/groups/9200000000000001/user/1000012345678/?__cft__[0]=AZ' }, [], 'Cora  Chen');
  const authorH5 = makeNode('h5', { role: 'heading' }, [rosaUserLink]);
  const hashtagLink = makeNode('a', { role: 'link', href: '/hashtag/hardbite' }, [], '#Hardbite芒果哈瓦那辣椒口味洋芋片');
  const longPostMessage = '#Hardbite 洋芋片是示範用的長訊息內容，刻意寫得超過八十個字元，用來驗證超長貼文仍能正確擷取第一行作為摘要，並且確認旁邊的外部網域文字不會被抓進摘要裡面。此段文字僅供測試使用。';
  const postMsgDiv = makeNode('div', { dir: 'auto' }, [hashtagLink], longPostMessage);
  const externalLinkSpan = makeNode('span', { dir: 'auto' }, [], 'xNBoy.com');
  const photoWithAlt = makeNode('img', { src: 'https://fbcdn.example/chips.jpg', alt: 'Cora  Chen 貼文的相片' });
  const rootHomeLink = makeNode('a', { href: '/?__cft__[0]=AZ' }, [], 'Facebook');

  const costcoCard = makeNode('article', {}, [rootHomeLink, groupH4, authorH5, postMsgDiv, externalLinkSpan, photoWithAlt]);
  const costcoSnapshot = metadata.collect(costcoCard, false);

  c.equals('Costco post actor is Cora Chen', costcoSnapshot && costcoSnapshot.actor, 'Cora Chen');
  c.equals('Costco post group is correct', costcoSnapshot && costcoSnapshot.group, '量販店零食交流社團');
  c.ok('Costco post snippet is post message not xNBoy.com', costcoSnapshot && costcoSnapshot.snippet && costcoSnapshot.snippet.indexOf('#Hardbite') !== -1 && costcoSnapshot.snippet.indexOf('xNBoy.com') === -1);
  c.ok('Costco author profile url points to user not root', costcoSnapshot && costcoSnapshot.urls && costcoSnapshot.urls.authorProfile && costcoSnapshot.urls.authorProfile.indexOf('/user/1000012345678') !== -1);

  // Post starting with numbers + time unit (e.g. "40年雖然...") and containing "m.me" CTA domain link
  const authorName = '山城小屋：雨都漫步：生活隨記';
  const authorProfileLink = makeNode('a', { role: 'link', href: '/profile.php?id=90000000000001' }, [], authorName);
  const storyAvatarLink = makeNode('a', { href: '/stories/900000000000000001/?view_single=false' });
  const authorH4 = makeNode('h4', { role: 'heading' }, [storyAvatarLink, authorProfileLink]);
  const followSpan = makeNode('span', { role: 'button' }, [], '· 追蹤');
  const relTimeSpan = makeNode('span', {}, [], '1 天前');
  const relTimeLink = makeNode('a', { href: '/?__cft__[0]=AZfakeCftTokenForTests000000&__tn__=%2CO%2CP-R#?jak' }, [], '1天');
  const post40Years = '40年雖然從數字上看很長，但對個人職涯而言不過是一瞬間，長期追蹤的研究特別值得慢慢看完。…… 查看更多';
  const postMsgDiv40 = makeNode('div', { dir: 'auto' }, [], post40Years);
  const mMeDomainSpan = makeNode('span', { dir: 'auto' }, [], 'm.me');
  const photoEl = makeNode('img', { src: 'https://fbcdn.example/40y.jpg' });

  const post40Card = makeNode('article', {}, [authorH4, followSpan, relTimeSpan, relTimeLink, postMsgDiv40, mMeDomainSpan, photoEl]);
  const post40Snapshot = metadata.collect(post40Card, false);

  c.equals('extracts correct author for 40-year post', post40Snapshot && post40Snapshot.actor, authorName);
  c.ok('post snippet starts with 40年雖然, not m.me', post40Snapshot && post40Snapshot.snippet && post40Snapshot.snippet.startsWith('40年雖然') && post40Snapshot.snippet.indexOf('m.me') === -1);
  c.equals('authorProfile url prefers exact author link over avatar story link', post40Snapshot && post40Snapshot.urls && post40Snapshot.urls.authorProfile, 'https://www.facebook.com/profile.php?id=90000000000001');
  c.equals('extracts timestamp text for 40-year post', post40Snapshot && post40Snapshot.timestamp && post40Snapshot.timestamp.text, '1天');
  c.equals('extracts timestamp url for 40-year post', post40Snapshot && post40Snapshot.timestamp && post40Snapshot.timestamp.url, 'https://www.facebook.com/?__cft__[0]=AZfakeCftTokenForTests000000&__tn__=%2CO%2CP-R#?jak');
  c.equals('urls.timestamp is populated', post40Snapshot && post40Snapshot.urls && post40Snapshot.urls.timestamp, 'https://www.facebook.com/?__cft__[0]=AZfakeCftTokenForTests000000&__tn__=%2CO%2CP-R#?jak');
  c.equals('urls.domPermalink falls back to timestamp url when no /posts/ exists', post40Snapshot && post40Snapshot.urls && post40Snapshot.urls.domPermalink, 'https://www.facebook.com/?__cft__[0]=AZfakeCftTokenForTests000000&__tn__=%2CO%2CP-R#?jak');


  // Dario Case 1: Pure emoji post 🤳 🚘 💥 👼 🛜 ❔ (rendered as img[alt]) + 13 photos + tagged friend
  const duncanAuthorLink = makeNode('a', { role: 'link', href: '/exampledesign' }, [], 'Dario');
  const duncanH2 = makeNode('h2', { role: 'heading' }, [duncanAuthorLink]);
  const emojiImgs1 = [
    makeNode('img', { alt: '🤳' }),
    makeNode('span', {}, [], ' '),
    makeNode('img', { alt: '🚘' }),
    makeNode('span', {}, [], ' '),
    makeNode('img', { alt: '💥' }),
    makeNode('span', {}, [], ' '),
    makeNode('img', { alt: '👼' }),
    makeNode('span', {}, [], ' '),
    makeNode('img', { alt: '🛜' }),
    makeNode('span', {}, [], ' '),
    makeNode('img', { alt: '❔' })
  ];
  const duncanMsg1 = makeNode('div', { 'data-ad-preview': 'message', dir: 'auto' }, emojiImgs1);
  const taggedPersonSpan = makeNode('span', { dir: 'auto' }, [], '王小明');
  const duncanTimelineUrl = 'https://www.facebook.com/exampledesign?__cft__[0]=AZfakeCftTokenForTests0001&__tn__=%2CO%2CP-R#?iha';
  const duncanTimeLink1 = makeNode('a', { href: duncanTimelineUrl }, [], '3分鐘前');
  const duncanCard1 = makeNode('article', {}, [duncanH2, duncanTimeLink1, duncanMsg1, taggedPersonSpan]);

  const duncanSnapshot1 = metadata.collect(duncanCard1, false);
  c.equals('Dario 1 actor extracted', duncanSnapshot1 && duncanSnapshot1.actor, 'Dario');
  c.equals('Dario 1 snippet extracts pure emojis', duncanSnapshot1 && duncanSnapshot1.snippet, '🤳 🚘 💥 👼 🛜 ❔');
  c.equals('Dario 1 timeline anchor URL preserves params for post location', duncanSnapshot1 && duncanSnapshot1.urls && duncanSnapshot1.urls.primary, duncanTimelineUrl);

  // Dario Case 2: Emoji post ⏸️⏩️⏪️▶️⏏️ + video player obfuscated hash token
  const emojiImgs2 = [
    makeNode('img', { alt: '⏸️' }),
    makeNode('img', { alt: '⏩️' }),
    makeNode('img', { alt: '⏪️' }),
    makeNode('img', { alt: '▶️' }),
    makeNode('img', { alt: '⏏️' })
  ];
  const duncanMsg2 = makeNode('div', { 'data-ad-preview': 'message', dir: 'auto' }, emojiImgs2);
  const hashSpan = makeNode('span', { dir: 'auto' }, [], 'TestObfuscatedHash000000000000000000000000000');
  const duncanPostUrl = 'https://www.facebook.com/exampledesign/posts/pfbid02SyntheticPostIdForTests000000000000000000000000000000000000?comment_id=2222222222222222&__cft__[0]=AZfakeCft';
  const duncanTimeLink2 = makeNode('a', { href: duncanPostUrl }, [], '1週');
  const duncanCard2 = makeNode('article', {}, [duncanH2, duncanTimeLink2, duncanMsg2, hashSpan]);

  const duncanSnapshot2 = metadata.collect(duncanCard2, false);
  c.equals('Dario 2 snippet extracts emojis not obfuscated hash', duncanSnapshot2 && duncanSnapshot2.snippet, '⏸️⏩️⏪️▶️⏏️');
  c.ok('Dario 2 post url strips __cft__ but keeps comment_id', duncanSnapshot2.urls.primary && duncanSnapshot2.urls.primary.indexOf('comment_id=2222222222222222') !== -1 && duncanSnapshot2.urls.primary.indexOf('__cft__') === -1);

  // Permalink synthesis from a caller-supplied (Relay) post id, for units whose DOM
  // carries neither a permalink link nor a timestamp link.
  const adaLink = makeNode('a', { role: 'link', href: '/adalovelace' }, [], 'Ada Lovelace');
  const adaHeading = makeNode('h3', { role: 'heading' }, [adaLink]);
  const adaMessage = makeNode('div', { dir: 'auto' }, [], '第一台分析機的筆記');
  const adaCard = makeNode('article', {}, [adaHeading, adaMessage]);

  c.equals('without a post id nothing is synthesized', metadata.collect(adaCard, false).urls.synthesized, null);
  c.equals('without a post id postUrl stays null', metadata.collect(adaCard, false).postUrl, null);

  const vanitySynth = metadata.collect(adaCard, false, { postId: '778899001122' });
  c.equals('vanity author link drives permalink synthesis', vanitySynth.urls.synthesized, 'https://www.facebook.com/adalovelace/posts/778899001122');
  c.equals('synthesized permalink surfaces as postUrl', vanitySynth.postUrl, 'https://www.facebook.com/adalovelace/posts/778899001122');

  const callerSynth = metadata.collect(adaCard, false, { postId: '778899001122', authorUsername: 'ada' });
  c.equals('caller author username takes precedence over DOM handle', callerSynth.urls.synthesized, 'https://www.facebook.com/ada/posts/778899001122');

  const groupMemberLink = makeNode('a', { role: 'link', href: '/groups/9000000000000001/user/1000012345678/?__cft__[0]=AZ' }, [], '回收社小幫手');
  const groupMemberHeading = makeNode('h3', { role: 'heading' }, [groupMemberLink]);
  const groupMemberMessage = makeNode('div', { dir: 'auto' }, [], '二手實木餐桌');
  const groupMemberCard = makeNode('article', {}, [groupMemberHeading, groupMemberMessage]);
  const groupSynth = metadata.collect(groupMemberCard, false, { postId: '9100000000000001' });
  c.equals('group membership link drives group permalink synthesis', groupSynth.urls.synthesized, 'https://www.facebook.com/groups/9000000000000001/permalink/9100000000000001/');

  const numericAuthorLink = makeNode('a', { role: 'link', href: '/profile.php?id=90000000000001' }, [], '山城小屋');
  const numericAuthorHeading = makeNode('h3', { role: 'heading' }, [numericAuthorLink]);
  const mentionedGroupLink = makeNode('a', { href: '/groups/9200000000000001/' }, [], '量販店零食交流社團');
  const numericMessage = makeNode('div', { dir: 'auto' }, [], '提到某個社團的一般貼文');
  const numericCard = makeNode('article', {}, [numericAuthorHeading, mentionedGroupLink, numericMessage]);
  const numericSynth = metadata.collect(numericCard, false, { postId: '4242424242' });
  c.equals('profile.php id becomes the numeric handle', numericSynth.urls.synthesized, 'https://www.facebook.com/90000000000001/posts/4242424242');

  const noAuthorLinkCard = makeNode('article', {}, [makeNode('h3', { role: 'heading' }, [makeNode('span', {}, [], '無連結作者')]), makeNode('div', { dir: 'auto' }, [], '只有社團連結的貼文'), makeNode('a', { href: '/groups/9200000000000001/' }, [], '某社團')]);
  c.equals('a stray group link alone is not enough to synthesize', metadata.collect(noAuthorLinkCard, false, { postId: '4242424242' }).urls.synthesized, null);
  c.equals('unsafe post id is never interpolated into a URL', metadata.collect(adaCard, false, { postId: '../x?v=1' }).urls.synthesized, null);

  // Reshare detection: structural pre-filter before any author-name comparison
  const reshareSharerHeader = makeNode('header', {}, [
    makeNode('h4', { role: 'heading' }, [makeNode('a', { role: 'link', href: '/sharer.page' }, [], '轉貼的人')]),
    makeNode('span', { dir: 'auto' }, [], '分享了')
  ]);
  const reshareOriginalHeader = makeNode('header', {}, [
    makeNode('h4', { role: 'heading' }, [makeNode('a', { role: 'link', href: '/original.author' }, [], '原作者')])
  ]);
  const reshareOriginalMessage = makeNode('div', { dir: 'auto' }, [], '被轉貼的原始內容');
  const reshareQuoted = makeNode('div', { role: 'article' }, [reshareOriginalHeader, reshareOriginalMessage]);
  const reshareCard = makeNode('article', {}, [reshareSharerHeader, reshareQuoted]);

  const reshareSnapshot = metadata.collect(reshareCard, false);
  c.equals('reshare reports the quoted author', reshareSnapshot.reshare && reshareSnapshot.reshare.originalActor, '原作者');
  c.equals('reshare reports the quoted message', reshareSnapshot.reshare && reshareSnapshot.reshare.originalTitle, '被轉貼的原始內容');

  // A commenter's article is nested content with a foreign author name, not a reshare source
  const commentAuthorHeading = makeNode('h4', { role: 'heading' }, [makeNode('a', { role: 'link', href: '/some.commenter' }, [], '留言者甲')]);
  const commentArticle = makeNode('div', { role: 'article' }, [commentAuthorHeading, makeNode('div', { dir: 'auto' }, [], '這是一則留言')]);
  const commentCard = makeNode('article', {}, [
    makeNode('header', {}, [makeNode('h4', { role: 'heading' }, [makeNode('a', { role: 'link', href: '/sharer.page' }, [], '轉貼的人')])]),
    makeNode('div', { dir: 'auto' }, [], '我的看法'),
    makeNode('form', {}, [commentArticle])
  ]);
  c.equals('comment subtree is never reported as a reshare', metadata.collect(commentCard, false).reshare, null);

  // A candidate wrapping the unit header is not a reshare
  const wrappedSharerHeader = makeNode('header', {}, [makeNode('h4', { role: 'heading' }, [makeNode('a', { role: 'link', href: '/sharer.page' }, [], '轉貼的人')])]);
  const wrappedQuotedHeader = makeNode('header', {}, [makeNode('h4', { role: 'heading' }, [makeNode('a', { role: 'link', href: '/original.author' }, [], '原作者')])]);
  const unitWrapper = makeNode('div', { role: 'article' }, [wrappedSharerHeader, makeNode('div', { dir: 'auto' }, [], '一般貼文'), wrappedQuotedHeader]);
  const wrapperCard = makeNode('article', {}, [unitWrapper]);
  c.equals('a candidate wrapping the unit header is not a reshare', metadata.collect(wrapperCard, false).reshare, null);

}

module.exports = { run };
