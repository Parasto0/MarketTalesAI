import { getJson, mapLimit } from './http.js';

const nyDate = (unixSec) =>
  new Date(unixSec * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

const pct = (a, b) => (b ? (a / b - 1) * 100 : null);
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const shiftDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5);

// Fetch daily bars around the period and derive its move plus context.
// A single day is the period from === to: baseline = close of the prior session, end = that day's close
// (or the latest session on/before `to` if the market was closed, e.g. a weekend or a not-yet-closed day).
export async function fetchQuote(ticker, { from, to }) {
  const p1 = Math.floor(shiftDays(from, -60).getTime() / 1000);
  const p2 = Math.floor(shiftDays(to, 2).getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${p1}&period2=${p2}&interval=1d`;
  const j = await getJson(url);
  const r = j?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error(`no chart data for ${ticker}`);
  const q = r.indicators.quote[0];
  const bars = r.timestamp
    .map((t, i) => ({ date: nyDate(t), close: q.close[i], volume: q.volume[i] }))
    .filter(b => b.close != null);

  let endIdx = -1;
  bars.forEach((b, i) => { if (b.date <= to) endIdx = i; });
  if (endIdx < 0) throw new Error(`insufficient bars for ${ticker}`);
  // If no session falls inside the period (weekend/holiday, or today's session not yet available), fall back
  // to the latest session on/before `to` measured against the session before it.
  const baseIdx = Math.min(bars.findLastIndex(b => b.date < from), endIdx - 1);
  if (baseIdx < 0) throw new Error(`insufficient bars for ${ticker}`);
  const end = bars[endIdx], base = bars[baseIdx];
  const back = (n) => bars[Math.max(0, endIdx - n)];

  const periodVol = bars.slice(baseIdx + 1, endIdx + 1).map(b => b.volume).filter(Boolean);
  const priorVol = bars.slice(Math.max(0, baseIdx - 19), baseIdx + 1).map(b => b.volume).filter(Boolean);
  const avgPeriod = mean(periodVol), avgPrior = mean(priorVol);

  const live = end.date === nyDate(Date.now() / 1000) && Date.now() / 1000 < (r.meta.currentTradingPeriod?.regular?.end ?? 0);

  return {
    ticker,
    name: r.meta.longName || r.meta.shortName || ticker,
    sessionDate: end.date,
    prevDate: base.date,
    sessions: endIdx - baseIdx,
    close: end.close,
    prevClose: base.close,
    changePct: pct(end.close, base.close),
    ret5dPct: pct(end.close, back(5).close),
    ret1mPct: pct(end.close, back(21).close),
    // A still-open session only has partial-day volume, which would look misleadingly "light": leave it out.
    volumeRatio: !live && avgPeriod && avgPrior ? avgPeriod / avgPrior : null,
    currency: r.meta.currency,
    // True while the end bar is today's still-open session, i.e. the "close" is a live intraday price.
    live,
  };
}

export async function findMovers(universe, { from, to, topN = 5, concurrency = 12 } = {}) {
  const res = await mapLimit(universe, concurrency, (t) => fetchQuote(t, { from, to }));
  const quotes = res.filter(x => x && !x.error && x.changePct != null);
  const failed = res.filter(x => x?.error).map(x => x.item);
  if (quotes.length < universe.length / 2) throw new Error(`market data mostly unavailable (${quotes.length}/${universe.length})`);
  // Only compare stocks measured over the same end session so stale tickers don't distort the ranking.
  const counts = {};
  quotes.forEach(q => (counts[q.sessionDate] = (counts[q.sessionDate] || 0) + 1));
  const sessionDate = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || b.localeCompare(a))[0];
  const live = quotes.filter(q => q.sessionDate === sessionDate).sort((a, b) => b.changePct - a.changePct);
  // Breadth across the whole universe: the factual basis of the "market mood" overview.
  const sortedMoves = live.map(q => q.changePct).sort((a, b) => a - b);
  const mid = Math.floor(sortedMoves.length / 2);
  const breadth = {
    advancers: live.filter(q => q.changePct > 0).length,
    decliners: live.filter(q => q.changePct < 0).length,
    avgChangePct: mean(sortedMoves),
    medianChangePct: sortedMoves.length % 2 ? sortedMoves[mid] : (sortedMoves[mid - 1] + sortedMoves[mid]) / 2,
    sessions: live[0]?.sessions ?? 1,
  };
  return {
    sessionDate,
    baselineDate: live[0]?.prevDate,
    sessionLive: live.filter(q => q.live).length > live.length / 2,
    breadth,
    scanned: live.length,
    failed,
    bullish: live.slice(0, topN).filter(q => q.changePct > 0),
    bearish: live.slice(-topN).reverse().filter(q => q.changePct < 0),
  };
}
