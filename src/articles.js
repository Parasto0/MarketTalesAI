import { getText } from './http.js';

const UA = 'Mozilla/5.0 (compatible; MarketTalesAI/0.1)';
const MAX_HTML = 1_500_000;
const MAX_CHARS = 1800; // per article, keeps LLM cost bounded

const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const clean = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Google News RSS links are redirects; resolve them to the publisher URL via Google's own batchexecute endpoint.
export async function resolveGoogleUrl(url) {
  const id = new URL(url).pathname.split('/').pop();
  const html = await getText(`https://news.google.com/rss/articles/${id}?hl=en-US&gl=US&ceid=US:en`, { retries: 0, timeoutMs: 10000 });
  const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sg || !ts) throw new Error('google redirect params not found');
  const inner = JSON.stringify(['garturlreq',
    [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id, Number(ts), sg]);
  const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', 'user-agent': UA },
    body: new URLSearchParams({ 'f.req': JSON.stringify([[['Fbv4je', inner, null, 'generic']]]) }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`google resolve HTTP ${res.status}`);
  const part = (await res.text()).split('\n\n')[1];
  const target = JSON.parse(JSON.parse(part)[0][2])[1];
  if (!/^https?:\/\//.test(target)) throw new Error('google resolve returned no url');
  return target;
}

function extract(html) {
  html = html.slice(0, MAX_HTML)
    .replace(/<(script|style|nav|footer|aside|header|form|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ');
  const meta = (name) => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i'));
    return m ? clean(m[1]) : '';
  };
  const region = html.match(/<article[\s\S]*?<\/article>/i)?.[0] || html;
  const paras = [...region.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => clean(m[1]))
    .filter((t) => t.length > 60 && !/cookie|subscribe|sign up|sign in|javascript|all rights reserved|advertisement/i.test(t));
  let text = '';
  for (const p of paras) { if (text.length >= MAX_CHARS) break; text += `${p} `; }
  text = text.trim().slice(0, MAX_CHARS);
  if (text.length >= 300) return { text, kind: 'full' };
  const desc = meta('og:description') || meta('description');
  return desc.length > 80 ? { text: desc.slice(0, 600), kind: 'summary' } : null;
}

// Returns { text, kind: 'full' | 'summary', finalUrl } or null (paywall, blocked, nothing usable).
export async function fetchArticle(url) {
  try {
    const target = url.includes('news.google.com/rss/articles/') ? await resolveGoogleUrl(url) : url;
    const html = await getText(target, { retries: 0, timeoutMs: 10000 });
    const got = extract(html);
    return got ? { ...got, finalUrl: target } : null;
  } catch {
    return null;
  }
}

// Reads up to `max` of the most relevant articles (closest to the session date, direct links first).
// Mutates the matching news items with { body, bodyKind, url (resolved) } and returns the count read.
export async function readTopArticles(news, sessionDate, { max = 3, candidates = 8 } = {}) {
  const ref = Date.parse(`${sessionDate}T12:00:00Z`);
  const score = (n) => {
    const d = n.published ? Math.abs(Date.parse(n.published) - ref) / 864e5 : 9;
    return d + (n.url.includes('news.google.com') ? 0.75 : 0); // direct publisher links are cheaper to read
  };
  const picked = [...news].sort((a, b) => score(a) - score(b)).slice(0, candidates);
  const results = await Promise.all(picked.map((n) => fetchArticle(n.url)));
  let read = 0;
  picked.forEach((n, i) => {
    const r = results[i];
    if (!r || read >= max) return;
    n.body = r.text;
    n.bodyKind = r.kind;
    n.url = r.finalUrl; // link readers straight to the publisher when we could resolve it
    read++;
  });
  return read;
}
