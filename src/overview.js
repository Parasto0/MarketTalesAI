const clamp = (x, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));

// Market mood from price breadth only (facts): advancer share + average move across the whole scanned universe.
// The average move is scaled by sqrt(sessions) so multi-day periods are not judged on a one-day yardstick.
export function computeMood(breadth) {
  const { advancers, decliners, avgChangePct, medianChangePct, sessions } = breadth;
  const share = advancers + decliners ? advancers / (advancers + decliners) : 0.5;
  const scale = 1.5 * Math.sqrt(Math.max(1, sessions));
  const score = 0.5 * clamp(avgChangePct / scale) + 0.5 * clamp((share - 0.5) * 2);
  const label = score >= 0.35 ? 'Bullish' : score >= 0.12 ? 'Leaning bullish'
    : score > -0.12 ? 'Mixed' : score > -0.35 ? 'Leaning bearish' : 'Bearish';
  return {
    score: Number(score.toFixed(3)),
    label,
    sign: score >= 0.12 ? '+' : score <= -0.12 ? '−' : '±',
    advancers, decliners, avgChangePct, medianChangePct,
  };
}

// AI outlook tally across the ten movers, per horizon (counts only; confidence-weighting is left to the cards).
export function computeLean(cards) {
  const lean = {};
  for (const h of ['d1', 'w1', 'm1']) {
    lean[h] = { Higher: 0, Lower: 0, Unclear: 0 };
    cards.forEach((c) => { lean[h][c.analysis.outlook[h].direction]++; });
  }
  return lean;
}
