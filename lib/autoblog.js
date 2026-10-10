/**
 * AI blog writing: the shared article generator (used by the dashboard's "Write with AI" and by the scheduler)
 * plus the scheduler that writes an article automatically every N days when enabled in Dashboard -> AI & chatbot.
 *
 * The scheduler is timestamp based: it checks regularly and writes an article whenever "last written + N days"
 * has passed, so a host that sleeps (e.g. Render's free tier) simply catches up the next time it wakes.
 */
const db = require('./store');
const gemini = require('./gemini');
const { HttpError, clip, stripTags, cleanRich, slugify } = require('./util');

const DAY = 24 * 3600 * 1000;
const CHECK_MS = 30 * 60 * 1000; // how often we look
const RETRY_MS = 6 * 3600 * 1000; // wait this long after a failed attempt
const DAILY_BLOG_LIMIT = 100;
const LENGTHS = { short: 450, medium: 850, long: 1400 };

const CTRL_RE = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]', 'g');
const ctrl = (s) => String(s == null ? '' : s).replace(CTRL_RE, '');
const today = () => new Date().toISOString().slice(0, 10);

function usedToday() {
  return (db.data.stats[today()] || {}).blog || 0;
}
function bumpBlog() {
  const d = (db.data.stats[today()] = db.data.stats[today()] || {});
  d.blog = (d.blog || 0) + 1;
  const days = Object.keys(db.data.stats).sort();
  while (days.length > 60) delete db.data.stats[days.shift()];
}

function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(t);
  } catch (_) {}
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try {
      return JSON.parse(t.slice(i, j + 1));
    } catch (_) {}
  }
  return null;
}

/** Writes one article with Gemini. Returns { title, excerpt, seoDescription, tags, bodyHtml } (already sanitised). */
async function generateArticle(opts) {
  const a = db.data.settings.ai;
  const s = db.data.settings.site;
  const topic = clip(ctrl(opts.topic).trim(), 600);
  if (topic.length < 4) throw new HttpError(400, 'Describe what the article should be about.');
  const words = LENGTHS[opts.length] || LENGTHS.medium;
  const tone = clip(ctrl(opts.tone || a.blogTone), 120);
  const language = clip(ctrl(opts.language || a.blogLanguage), 40) || 'English';
  const system = [
    `You are a senior content writer for ${s.name}, a rice-mill machinery manufacturer (elevators, paddy dryers, parboiling plants, silos, conveyors, dust collectors).`,
    'Write genuinely useful, accurate articles for mill owners and operators. Do not invent statistics, awards, customer names or prices; when unsure, stay general.',
    'Output ONLY a JSON object, no commentary, with exactly these keys:',
    '"title" (max 70 chars, no clickbait), "excerpt" (1-2 sentences, max 200 chars), "metaDescription" (max 155 chars), "tags" (array of 3-5 short lowercase tags), "bodyHtml" (the article).',
    'bodyHtml must use only these tags: h2, h3, p, ul, ol, li, strong, em, blockquote. Do not include an h1 or the title again. Start with a short intro paragraph, use descriptive h2 subheadings, and end with a brief practical takeaway.',
  ].join('\n');
  const prompt = [
    `Topic: ${topic}`,
    opts.keywords ? `Keywords to work in naturally: ${clip(ctrl(opts.keywords), 200)}` : '',
    opts.audience ? `Audience: ${clip(ctrl(opts.audience), 120)}` : '',
    `Tone: ${tone}`,
    `Language: ${language}`,
    `Target length: about ${words} words.`,
    opts.notes ? `Extra notes from the editor: ${clip(ctrl(opts.notes), 600)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const text = await gemini.generate({ system, messages: [{ role: 'user', text: prompt }], temperature: 0.7, maxTokens: 8192, json: true, noThinking: true, timeoutMs: 90000 });
  const j = parseJson(text);
  if (!j || typeof j.bodyHtml !== 'string') throw new HttpError(502, 'Gemini returned an answer in an unexpected format. Please try again.');
  return {
    title: clip(stripTags(j.title || topic), 160),
    excerpt: clip(stripTags(j.excerpt || ''), 300),
    seoDescription: clip(stripTags(j.metaDescription || ''), 300),
    tags: (Array.isArray(j.tags) ? j.tags : []).map((t) => clip(stripTags(t).toLowerCase(), 30)).filter(Boolean).slice(0, 8),
    bodyHtml: cleanRich(j.bodyHtml),
  };
}

function uniqueSlug(base) {
  const s = slugify(base) || 'article';
  let out = s, n = 2;
  while (db.data.posts.some((x) => x.slug === out)) out = s + '-' + n++;
  return out;
}

// ---------------------------------------------------------------- settings helpers
const clampDays = (n) => Math.min(90, Math.max(1, Math.round(+n) || 7));
function topicList(ab) {
  return String(ab.topics || '')
    .split(/\r?\n/)
    .map((t) => ctrl(t).trim())
    .filter((t) => t.length >= 4)
    .slice(0, 40);
}

/** When the next automatic article is due (ms timestamp), or null when switched off. */
function nextRunAt() {
  const ab = db.data.settings.ai.autoBlog;
  if (!ab || !ab.enabled) return null;
  const anchor = Date.parse(ab.lastRunAt) || Date.parse(ab.enabledAt) || Date.now();
  let due = anchor + clampDays(ab.everyDays) * DAY;
  if (ab.lastError && Date.parse(ab.lastAttemptAt)) due = Math.max(due, Date.parse(ab.lastAttemptAt) + RETRY_MS);
  return due;
}

function pickTopic(ab) {
  const list = topicList(ab);
  if (list.length) return { topic: list[(ab.topicIndex || 0) % list.length], fromList: true };
  const recent = db.data.posts
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 30)
    .map((p) => p.title);
  return {
    topic:
      'Choose one fresh, practical topic that rice mill owners and operators would value (for example sizing, drying, parboiling, storage, maintenance, energy saving, safety or quality). ' +
      (recent.length ? 'It must not repeat or closely overlap any of these existing articles: ' + recent.join(' | ') + '.' : ''),
    fromList: false,
  };
}

let running = false;

/** Writes one article now and saves it as a draft or published post, per the dashboard setting. */
async function runOnce() {
  const a = db.data.settings.ai;
  const ab = a.autoBlog;
  if (running) throw new HttpError(409, 'An article is already being written. Please wait a minute.');
  if (!gemini.hasKey()) throw new HttpError(400, 'Add a Gemini API key first (Dashboard → AI & chatbot).');
  if (usedToday() >= DAILY_BLOG_LIMIT) throw new HttpError(429, `Today's AI blog limit (${DAILY_BLOG_LIMIT}) has been reached.`);
  running = true;
  ab.lastAttemptAt = new Date().toISOString();
  try {
    const { topic, fromList } = pickTopic(ab);
    const art = await generateArticle({ topic });
    const now = new Date().toISOString();
    const publish = ab.mode === 'publish';
    const post = {
      id: db.id(),
      slug: uniqueSlug(art.title),
      title: art.title,
      excerpt: art.excerpt,
      bodyHtml: art.bodyHtml,
      cover: '',
      coverAlt: '',
      status: publish ? 'published' : 'draft',
      tags: art.tags,
      seoTitle: '',
      seoDescription: art.seoDescription,
      aiGenerated: true,
      author: 'AI writer',
      createdAt: now,
      updatedAt: now,
      publishedAt: publish ? now : null,
    };
    db.data.posts.push(post);
    bumpBlog();
    ab.lastRunAt = now;
    ab.lastError = '';
    ab.lastPostId = post.id;
    ab.lastResult = `Wrote "${post.title}" (${publish ? 'published' : 'saved as a draft'})`;
    if (fromList) ab.topicIndex = (ab.topicIndex || 0) + 1;
    db.log(null, `AI wrote an article: ${post.title} (${publish ? 'published' : 'draft'})`);
    db.save();
    return post;
  } catch (e) {
    ab.lastError = e && e.message ? clip(e.message, 300) : 'Could not write the article.';
    db.save();
    throw e;
  } finally {
    running = false;
  }
}

async function tick() {
  try {
    const due = nextRunAt();
    if (!due || Date.now() < due || running) return;
    if (!gemini.hasKey() || usedToday() >= DAILY_BLOG_LIMIT) return;
    await runOnce();
  } catch (e) {
    console.error('[autoblog]', e && e.message ? e.message : e);
  }
}

function start() {
  setInterval(tick, CHECK_MS).unref();
  setTimeout(tick, 2 * 60 * 1000).unref();
}

module.exports = { generateArticle, runOnce, tick, start, nextRunAt, clampDays, topicList, usedToday, bumpBlog, parseJson };
