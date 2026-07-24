# J7Tracker

Tracks wallet activity across Ethereum, Robinhood Chain, and Solana, scans
Solana tokens for rug/scam risk, pulls crypto and world news, and includes
a voice-enabled AI assistant grounded in your live data. Read-only — no
funds are held or moved by this app.

## Setup

1. **Install the Netlify CLI** (if you don't have it):
   ```
   npm install -g netlify-cli
   ```

2. **Install dependencies:**
   ```
   npm install
   ```

3. **Get your API keys:**
   - **Etherscan** (Ethereum tracking) — etherscan.io/myapikey
   - **Helius** (Solana tracking + token risk scans) — helius.dev
   - **Groq** (chat assistant) — console.groq.com
   - **Reddit** (optional, trend tracking) — reddit.com/prefs/apps, create a
     "script" app, no cost
   - News (crypto + world) — no key needed, free RSS feeds
   - Robinhood Chain — no key needed, free Blockscout explorer API

4. **Copy `.env.example` to `.env`** and fill in your keys.

5. **Run locally:** `netlify dev` — opens at http://localhost:8888

## Deploying to Netlify

1. Push this folder to a GitHub repo.
2. Netlify: New site from Git, select the repo. Build settings are already
   set in `netlify.toml`.
3. Add your environment variables in Site settings → Environment variables
   (same keys as your `.env`).
4. Deploy.

## Homepage layout

- **Greeting + Ask J7 box** — type or speak a question. Combines general
  crypto knowledge with your live tracked data (wallets, watchlist, news).
- **Wallets card** — tap to expand: add/remove watched wallets, see recent
  wallet activity.
- **Updates card** — tap to expand: trending topics and headlines from
  crypto news (CoinDesk, Cointelegraph) and world news (BBC, Al Jazeera).
- **Watchlist card** — tap to expand: scan a Solana token for rug/scam
  risk, see past scans.

## Voice

- Tap the mic pill in the ask box to speak a question hands-free — it
  transcribes, sends, and speaks the reply back automatically.
- Toggle "Listen for 'J7 activate'" to enable a wake word. While the app
  is open in the browser tab, saying "J7 activate" starts listening for
  your question automatically — no tap needed.
- Both use the browser's free built-in Web Speech API (best support in
  Chrome). No API key needed. Voice quality is functional, not
  studio-natural — upgrading to a paid engine (e.g. ElevenLabs for
  speech, Whisper for transcription) is a future option if wanted.
- Important limitation: this only works while the tab is open and active.
  Unlike a phone's native "Hey Siri"/"Hey Google", a website cannot listen
  in the background once the tab or app is closed — that requires OS-level
  permissions no web app can get.

## Token risk scanner (Solana)

Checks mint authority, freeze authority, Token-2022 backdoor extensions
(permanent delegate, transfer hook, transfer fee), top-10 holder
concentration (with pool-vs-wallet detection on the largest holder),
liquidity depth, and volume/buy-sell patterns via Helius and DexScreener
(free, no key for DexScreener). Heuristic, not a guarantee — treat as one
input, not a final answer.

## Chat assistant

Combines general crypto knowledge with your live tracked data — full
watchlist, up to 50 recent wallet signals, current news and trends — via
Groq (default model: openai/gpt-oss-120b). Won't give direct buy/sell
advice; explains risk factors and leaves the decision to you.

Conversation history now persists in your browser across sessions (last
60 messages), so it has continuity rather than starting fresh every time
you reload. This isn't the model "learning" in a machine-learning sense —
that's not something an API-based assistant can do — it's remembering
your past conversation, which is the realistic version of that.

## Known fixes in this version

- **Token risk scans were returning stale/cached results** on repeat
  scans of the same token. Fixed by adding explicit no-cache headers to
  every data function's response, plus a cache-busting parameter on the
  frontend. If you scanned a token before this fix, re-scan it once to
  get a fresh result going forward.
- **Solana wallet activity wasn't loading** — Helius had moved their API
  off the old `api.helius.xyz` domain to `api-mainnet.helius-rpc.com`.
  Fixed.
- **Chat model was on a deprecated Groq model** (`llama-3.3-70b-versatile`,
  deprecated June 17, 2026). Switched to `openai/gpt-oss-120b`, Groq's
  recommended replacement.

## Project structure

```
public/              static frontend (index.html, app.js, styles.css)
netlify/functions/   serverless functions, one per data source
  wallets-eth.js        Ethereum wallet activity (Etherscan)
  wallets-robinhood.js  Robinhood Chain wallet activity (Blockscout)
  wallets-solana.js     Solana wallet activity (Helius)
  reddit.js             Reddit trend signals (needs OAuth app credentials)
  news.js                Crypto + world news (CoinDesk, Cointelegraph, BBC, Al Jazeera RSS, no key)
  token-risk.js          Solana token risk scanner (Helius + DexScreener)
  chat.js                 AI assistant grounded in live data (Groq)
```

## Notes

- Watched wallets and scanned tokens are stored in the browser only
  (localStorage), not on any server.
- Data refreshes every 5 minutes automatically.
- No wallet with a private key is created or used by this app — it only
  reads public on-chain and social data. No auto-execution/trading.

## This round's additions

- **Trend synthesis over time** — the app now saves periodic trend
  snapshots (browser-local), and the chat assistant gets a condensed
  time series of them, so it can answer questions like "how has
  sentiment shifted" rather than only reacting to the current moment.
- **Live-recalculated timestamps** — wallet signal and news timestamps
  are now computed fresh on every render (and re-rendered every 30s),
  instead of a server-baked "X minutes ago" string that goes stale.
- **Tap-to-scan on wallet buy signals** — when a tracked Solana wallet
  buys a token, the signal shows a "tap to scan this token" prompt;
  tapping runs a live risk scan on that token and opens the Watchlist.
  Note: this shows the token's *current* market cap/details, not a
  historical snapshot at the moment of purchase — reliable historical
  market cap at an arbitrary past transaction isn't available through
  free tools, so this is the honest, deliverable version.
- **Live price charts** — a Charts card (free DexScreener embed, no key)
  showing the general Solana market by default, or a specific token's
  chart after you scan it or tap a Watchlist entry. On desktop (≥900px)
  it sits as a 4th panel alongside Wallets/Updates/Watchlist; on mobile
  it's the same collapsible card pattern as the others.
- **In-app risk alerts** — each refresh cycle, the 3 most recently
  scanned Watchlist tokens are quietly re-checked; if a token's risk
  level changes, an alert banner appears above the cards. This is
  in-app only for now (not push notifications that reach you with the
  tab closed) — that's a bigger step involving a service worker and
  notification permissions, doable later if wanted.
- **Voice quick-commands** — beyond "J7 activate" (opens the mic for a
  full question), you can also say "J7 portfolio" (opens Wallets),
  "J7 next card" (cycles through sections), or "J7 clear logs" (clears
  chat history and wallet signal log) for instant actions without a
  full chat round-trip.
- **Tightened concentration thresholds** — top-10 holder concentration
  above 30% now flags as medium risk (was 50%), with higher brackets
  at 50%/70%/90% scaling risk further.
- **Bundled wallet detection** — checks whether several of a token's
  next-largest holders (after the top one) look like freshly created,
  low-activity wallets — a common signature of a deployer splitting
  supply across many wallets to dodge concentration checks before
  dumping them together. Heuristic based on transaction count, not a
  certainty.
- **Liquidity lock check** — for tokens still on Pump.fun's bonding
  curve, liquidity is locked by design (flagged as OK). For tokens
  migrated to Raydium, the scanner looks up the pool's LP token and
  checks whether it's burned, held by a program (possibly locked), or
  sitting in a plain wallet (real rug risk — flagged high). This covers
  the most common patterns but not every locker service or burn method,
  so treat "unknown" results as "verify manually," not "safe."

## Known limitation: wake word reliability

Chrome's continuous speech recognition tends to drop out after brief
silence even with auto-restart logic in place (a documented Web Speech
API quirk, more pronounced on Android Chrome than desktop). The restart
logic has been tightened with a short delay to reduce this, but it may
still occasionally need re-toggling if it goes quiet for a while.

## Hub-style desktop layout

Desktop (≥900px) now opens to a hub view — Wallets, Updates, Watchlist,
and Charts shown as connected nodes radiating from a central circle
reserved for Stage 3 (locked, "Reserved" - nothing lives there yet).
Tapping a node fades the hub out and that section takes over full width,
with a "Back to overview" button to return. Mobile is unaffected — it
keeps the original stacked, collapsible card layout, since there isn't
room for a hub layout on a narrow screen.

## Voice system rewrite (real bug fix)

Previously the wake word and the manual voice button used two separate
SpeechRecognition instances. Browsers generally only allow one active
recognition session at a time, so whichever one grabbed the microphone
first silently blocked the other — this was the actual cause of both
being unreliable together. Now there's a single shared recognition
instance with a mode flag ('idle' / 'wake' / 'command') that properly
hands off between wake-listening and one-off voice commands. Recognition
errors (e.g. denied microphone permission) now show a real alert instead
of failing silently, so if voice still doesn't work after this update,
the browser will tell you why.

## Chat grounding fixes

- The chat assistant now receives a live SOL/USD price fetched fresh on
  every refresh (via a new price.js function, free DexScreener data, no
  key) and is explicitly instructed to only state prices that are in
  that live data — not to guess from its own training memory, which was
  the cause of it stating a wildly wrong SOL price before.
- Watchlist entries are now explicitly framed to the model as "as of
  when scanned," not current, to avoid it treating old scan data as live.
- Rewritten as an "elite Solana quantitative risk analyst" persona,
  prioritizing liquidity ratios, holder concentration, bonding curve
  progress, and volume/liquidity spikes in its reasoning.
- Token risk scans now include bonding curve progress for Pump.fun
  tokens (approximated from market cap vs. the ~$69k/85 SOL graduation
  threshold — a close proxy, not an exact read of on-chain curve
  reserves), which the chat assistant can also reference.

## Chart embed fix

The chart was stuck on "Loading pair..." because the embed was given a
raw token mint address instead of an actual trading pair address, which
DexScreener's widget needs to resolve. Fixed: the general Solana chart
now uses a real, established SOL/USDC pair, and per-token charts use the
pair address already returned by the token risk scan instead of the
mint.
