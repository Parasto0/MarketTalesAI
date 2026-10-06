import { getJson, getText } from './http.js';

const decode = (s) => s
  .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
const tag = (xml, t) => {
  const m = xml.match(new RegExp(`<${t}[^>]*>(.*?)</${t}>`, 's'));
  return m ? decode(m[1]) : '';
};

async function yahooNews(ticker) {
  const j = await getJson(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=8&quotesCount=0`);
  return (j.news || []).map(n => ({
    title: n.title,
    publisher: n.publisher,
    url: n.link,
    published: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : null,
    // Keep only items Yahoo explicitly associates with this ticker.
    related: (n.relatedTickers || []).includes(ticker),
  })).filter(n => n.title && n.url && n.related);
}

async function googleNews(ticker, name, since, until, extra = '') {
  const short = name.replace(/,? (Inc|Corp|Corporation|Ltd|Co|Company|plc)\.?$/i, '');
  const q = encodeURIComponent(`"${short}" OR ${ticker} stock ${extra} after:${since} before:${until}`.replace(/\s+/g, ' '));
  const xml = await getText(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`);
  return [...xml.matchAll(/<item>(.*?)<\/item>/gs)].slice(0, 10).map(m => {
    const it = m[1];
    const publisher = tag(it, 'source');
    let title = tag(it, 'title');
    if (publisher && title.endsWith(` - ${publisher}`)) title = title.slice(0, -(publisher.length + 3));
    const pub = tag(it, 'pubDate');
    return { title, publisher, url: tag(it, 'link'), published: pub ? new Date(pub).toISOString() : null };
  }).filter(n => n.title && n.url);
}

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

// Up to `limit` de-duplicated headlines inside [from - 3d, to + 2d] (newest first), so a past date only sees
// news from around that time. Headlines only: no full-article fetching.
export async function fetchNews(ticker, name, { from, to, direction = 0, limit = 10 }) {
  const lo = Date.parse(`${from}T00:00:00Z`) - 3 * 864e5;
  const hi = Date.parse(`${to}T00:00:00Z`) + 3 * 864e5; // exclusive upper bound = to + 2 full days
  // Second query targets explanatory coverage ("why is X moving") in the direction of the move.
  const why = direction >= 0 ? 'why shares jump surge rally' : 'why shares fall drop slide';
  const [y, g, g2] = await Promise.allSettled([
    yahooNews(ticker),
    googleNews(ticker, name, ymd(lo), ymd(hi)),
    googleNews(ticker, name, ymd(lo), ymd(hi), why),
  ]);
  const all = [...(y.value || []), ...(g.value || []), ...(g2.value || [])];
  const seen = new Set();
  return all
    .filter(n => !n.published || (Date.parse(n.published) >= lo && Date.parse(n.published) < hi))
    .filter(n => {
      const k = n.title.toLowerCase().replace(/\W+/g, ' ').slice(0, 60);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0))
    .slice(0, limit);
}
