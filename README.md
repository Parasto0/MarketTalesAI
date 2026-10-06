# MarketTales AI (MVP)

Autonomous research agent: finds the 5 biggest bullish and 5 biggest bearish movers among ~110 large-cap US stocks, researches each one (recent news plus the text of the most relevant articles), and writes a concise directional-outlook report with sources.

## Web UI

```
npm start        # or: node src/server.js   ->  http://localhost:3000
```

Pick a single day, a date range, or a month, then press **Analyze Market**. A morning overview shows market mood (from price breadth across the universe), an AI one-line story and the AI outlook tally of the 10 movers. Bullish/bearish cards show the move, reason and 1D/1W/1M outlook tiles (colour = direction, fill = confidence: solid High, tinted Medium, dashed Low); click a card for What happened (fact) → Why (short sourced bullets) → What may happen next → What could change it (upside/risk scenarios) → Sources. The server binds to localhost only and runs one analysis at a time. Set `PORT` to change the port.

For ranges, each stock's move is measured from the close before the period to the close at its end, and news is limited to that period (+/- a few days).

## CLI

```
node src/index.js "Analyze today's top market movers." [--date YYYY-MM-DD | --from YYYY-MM-DD --to YYYY-MM-DD]
```

Both write `reports/market-movers-<date>.md` (+ raw `.json`); the CLI also prints the markdown. No dependencies; Node 20+.

## Pipeline
0. `pipeline.js` – shared by the CLI and the server (`runAnalysis`); `server.js` + `public/index.html` are the UI.
1. `market.js` – Yahoo Finance chart API (no key) -> period move, 5d/1m return, volume ratio; ranks the universe (`universe.js`).
2. `news.js` – Yahoo search news + two Google News RSS queries (no key), limited to the period. `articles.js` then reads the text of the ~3 most relevant articles per stock (resolving Google News links to the publisher page); paywalled or blocked pages fall back to headline/summary only.
3. `llm.js` / `analyze.js` – one analysis per stock. Uses `ANTHROPIC_API_KEY` (Messages API, model via `MARKETTALES_MODEL`) if set, otherwise the logged-in `claude` CLI in headless mode with tools disabled. The model is told to give a directional view when the evidence supports one and to use "Unclear" only when it genuinely does not. Output is validated: cited sources must be supplied items; "Unclear" is forced to Low confidence; failures degrade to "Unclear", never invented text.
4. `overview.js` – market mood (breadth + average move across all scanned stocks) and the outlook tally. `report.js` – deterministic markdown. Prices/moves are computed facts; catalysts/outlooks are labelled AI interpretation.

## Limitations
- When the requested session is still open, moves use live intraday prices and the UI/report say so; if it has no data yet, the latest available session is used and stated.
- Some publishers block automated reads; those articles are used as headline-only.
- Universe is a fixed list, so a small-cap or non-listed mover will not appear.
- Not investment advice; no trading functionality.
