import { getJson, mapLimit } from './http.js';

const nyDate = (unixSec) =>
  new Date(unixSec * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

const pct = (a, b) => (b ? (a / b - 1) * 100 : null);

// Fetch ~3 months of daily bars and derive the latest session's move plus context.
export async function fetchQuote(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=3mo&interval=1d`;
  const j = await getJson(url);
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(`no chart data for ${ticker}`);
  const q = r.indicators.quote[0];
  const bars = r.timestamp
    .map((t, i) => ({ t, date: nyDate(t), close: q.close[i], volume: q.volume[i] }))
    .filter(b => b.close != null);
  if (bars.length < 3) throw new Error(`too few bars for ${ticker}`);
  const last = bars.at(-1), prev = bars.at(-2);
  const at = (n) => bars[Math.max(0, bars.length - 1 - n)];
  const prior20 = bars.slice(-21, -1).filter(b => b.volume);
  const avgVol = prior20.length ? prior20.reduce((s, b) => s + b.volume, 0) / prior20.length : null;
  return {
    ticker,
    name: r.meta.longName || r.meta.shortName || ticker,
    sessionDate: last.date,
    prevDate: prev.date,
    close: last.close,
    prevClose: prev.close,
    changePct: pct(last.close, prev.close),
    ret5dPct: pct(last.close, at(5).close),
    ret1mPct: pct(last.close, at(21).close),
    volumeRatio: avgVol && last.volume ? last.volume / avgVol : null,
    currency: r.meta.currency,
  };
}

export async function findMovers(universe, { topN = 5, concurrency = 12 } = {}) {
  const res = await mapLimit(universe, concurrency, fetchQuote);
  const quotes = res.filter(x => x && !x.error && x.changePct != null);
  const failed = res.filter(x => x?.error).map(x => x.item);
  if (quotes.length < universe.length / 2) throw new Error(`market data mostly unavailable (${quotes.length}/${universe.length})`);
  // Only compare stocks on the most common (latest) session so stale tickers don't distort the ranking.
  const counts = {};
  quotes.forEach(q => (counts[q.sessionDate] = (counts[q.sessionDate] || 0) + 1));
  const sessionDate = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || b.localeCompare(a))[0];
  const live = quotes.filter(q => q.sessionDate === sessionDate).sort((a, b) => b.changePct - a.changePct);
  return {
    sessionDate,
    scanned: live.length,
    failed,
    bullish: live.slice(0, topN).filter(q => q.changePct > 0),
    bearish: live.slice(-topN).reverse().filter(q => q.changePct < 0),
  };
}
