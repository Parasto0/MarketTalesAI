# MarketTales AI (MVP)

Autonomous research agent: finds the 5 biggest bullish and 5 biggest bearish movers among ~110 large-cap US stocks, gathers recent headlines for each, and writes a concise directional-outlook report with sources.

## Web UI

```
npm start        # or: node src/server.js   ->  http://localhost:3000
```

Pick a single day, a date range, or a month, then press **Analyze Market**. Bullish/bearish cards show the move, catalyst and 1D/1W/1M outlook chips; click a card for What happened (fact) → Why (AI interpretation) → Outlook (AI forecast) → Sources. The server binds to localhost only and runs one analysis at a time. Set `PORT` to change the port.

For ranges, each stock's move is measured from the close before the period to the close at its end, and news is limited to that period (+/- a few days).

## CLI

```
node src/index.js "Analyze today's top market movers." [--date YYYY-MM-DD | --from YYYY-MM-DD --to YYYY-MM-DD]
```

Both write `reports/market-movers-<date>.md` (+ raw `.json`); the CLI also prints the markdown. No dependencies; Node 20+.

## Pipeline
0. `pipeline.js` – shared by the CLI and the server (`runAnalysis`); `server.js` + `public/index.html` are the UI.
1. `market.js` – Yahoo Finance chart API (no key) -> period move, 5d/1m return, volume ratio; ranks the universe (`universe.js`).
2. `news.js` – Yahoo search news + Google News RSS (no key); headlines only, last ~4 days.
3. `llm.js` / `analyze.js` – one analysis per stock. Uses `ANTHROPIC_API_KEY` (Messages API, model via `MARKETTALES_MODEL`) if set, otherwise the logged-in `claude` CLI in headless mode with tools disabled. Output is validated: cited sources must be supplied headlines; "Unclear" is forced to "Low" confidence; failures degrade to "Unclear — Low", never invented text.
4. `report.js` – deterministic markdown. Prices/moves are computed facts; catalysts/outlooks are labelled AI interpretation.

## Limitations
- Evidence is headlines only (article bodies are not read), so most outlooks will honestly be "Unclear — Low".
- Moves reflect the latest completed session in the data; the report states this if it differs from the requested date.
- Universe is a fixed list, so a small-cap or non-listed mover will not appear.
- Not investment advice; no trading functionality.
