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

## Full hub-only homepage redesign

Desktop now opens directly to the hub square — no header text, no
always-visible ask box or chat log above it. The hub square IS the
homepage: Wallets, Updates, Watchlist, and Charts as four corner nodes,
center reserved for Stage 3, and a floating "Ask J7" button anchored to
the bottom edge of the square for the AI chat. Tapping any node (including
Ask J7) fades the hub and that section takes over full width, with a
"Back to overview" button to return - the AI chat now behaves exactly
like every other section instead of being a separate persistent area.

Mobile keeps the same five sections as stacked, collapsible cards (Ask J7
first), consistent with the desktop model minus the hub visual.

## Charts: no longer embedded, opens externally

Embedding DexScreener's site directly in an iframe was unreliable - it's
not built for third-party embedding, and it could hang on "Loading
pair..." indefinitely instead of failing with a clear error. Charts now
opens the real DexScreener page in a new browser tab instead - slightly
more clicks, but it works every time. The Charts section is just a small
launcher with two buttons: general Solana market, and (once you've
scanned something) the last scanned token's chart. Watchlist entries are
also individually clickable to open their chart in a new tab.

## Spoken greeting

On load, the app speaks a time-of-day greeting ("Good afternoon, Edwin.
What are we tracking today?") instead of displaying it as text - there's
no more greeting text block on the homepage at all. Note: browsers often
block audio, including speech synthesis, from playing automatically
before the user has interacted with the page at all. If the greeting
doesn't play on first load, that's this browser restriction, not a bug -
tapping anywhere on the page first (then reloading) or subsequent visits
in the same session often resolves it.

## Sidebar dashboard redesign

Desktop now uses a full sidebar dashboard layout (Home, Wallets,
Watchlist, Analytics, Charts, AI Trade Bot, Ask J7, Settings), matching
a SaaS-dashboard visual style: hero banner, feature cards, stat panels,
a Smart Alerts panel, and live trending Solana tokens. All real data
(wallets, scans, alerts, trending tokens) comes from the same backend
functions as before - nothing new was fabricated for the layout itself.

**One deliberate exception, clearly labeled:** the "AI Trade Bot" page
and the Home page's AI Trade Agent panel show illustrative sample data
(e.g. "Bought 12.45 SOLDEGEN") to preview what Stage 3 autonomous
execution will eventually look like. This is marked with an explicit
"DEMO DATA — Stage 3 not active" badge and explanatory text. It is never
real trade data — J7Tracker has never held a private key or moved funds.
This was a deliberate choice (asked and confirmed) rather than silently
fabricating fake activity.

Mobile is unaffected — same stacked, collapsible card layout as before.

## Real trending Solana tokens (not stale training data)

Added a new function (trending-tokens.js) pulling DexScreener's free
"latest boosted tokens" feed, filtered to Solana and sorted by actual
24h volume. This fixed a real problem: the chat assistant had no live
data source for current trending tokens, so it was falling back on
famous historical memecoins from its own training memory (BONK, PEPE,
SHIB) when asked what's trending today. Now it's explicitly instructed
to use only this live list and say so plainly if it's empty, rather than
guessing from memory.

## Robinhood Chain / Ethereum wallet activity fix

Both wallet functions were silently filtering out any transaction that
didn't move plain native currency. Since most real activity on Robinhood
Chain (tokenized stock trades) and a lot of Ethereum activity (token
swaps, approvals) happens via contract calls carrying zero native ETH
value, this filter was hiding almost everything - which is why Robinhood
Chain wallets showed "no available data." Fixed: contract-call
transactions are now shown too, not just plain transfers.

## Deployer history check (Stage 2)

New: token scans now check whether the deployer wallet has recently
created other Pump.fun tokens, using the real "create" instruction
discriminator (not just a guess) - a genuine serial-deployer signal, a
common rug pattern where one wallet launches many tokens and abandons
each one. This is a bounded, heuristic check: it only samples the
deployer's most recent ~8 transactions to keep scan time reasonable, so
it will miss creations further back in their history or a deployer
who's gone quiet since. When it does find something, it's real on-chain
evidence, just not an exhaustive record.

## Portfolio value tracking (Stage 1)

New: Solana wallets in the Wallets section now show an actual USD value
(SOL balance + priced token holdings), not just activity signals. Uses
Helius for balances/holdings and DexScreener for pricing - same free
tiers as everything else. Only Solana wallets get this for now, since
that's where the pricing/holdings tooling is already built out.

## Alerts scope expanded

Risk-change re-checks now cover your 10 most recently scanned tokens
instead of just 3.

## Still open (not built this round)

- **Reddit** is still not connected - blocked on the OAuth app
  credentials from earlier, not something fixable in code alone.
- **Cross-device sync** - everything still lives in browser
  localStorage only. A real fix (server-side sync so your data follows
  you across devices) is a bigger addition worth its own dedicated pass
  rather than rushing it in alongside everything else this round.
- **Push notifications for alerts** - still in-app only, requires a
  service worker and notification permissions to reach you with the tab
  closed.
- **Deployer history for Ethereum/Robinhood Chain tokens** - only built
  for Solana so far, since risk scanning in general is Solana-only.

## Multi-chain risk scanning (Ethereum + Robinhood Chain)

Watchlist now has a chain selector - Solana uses the original scanner,
Ethereum and Robinhood Chain use a new one (token-risk-evm.js) checking:
contract source verification, ownership renouncement (via eth_call to the
standard owner() function), holder concentration (Robinhood Chain only -
Etherscan's free tier doesn't expose a holder list for Ethereum), and
liquidity/volume via DexScreener.

**Default security layer: GoPlus Security** (free, no key, no signup -
covers Ethereum only, since Robinhood Chain is too new for their
supported chain list). Checks honeypot risk, mintability, hidden owners,
buy/sell tax, and more.

**Optional extra layer: honeypot.is** - unlike GoPlus, this needs its own
free API key (HONEYPOT_API_KEY). Not required; GoPlus alone covers
honeypot detection by default.

## Solana scan cross-validation

Solana scans now also query two free third-party scanners as a sanity
check against our own analysis: **GoPlus's Solana beta endpoint** and
**RugCheck.xyz**. Both are wrapped defensively - if either is unreachable
or its response doesn't match the expected shape, the scan just
continues without them rather than failing.

## Wallet nicknames, coin breakdown, and activity filters

- **Nicknames**: add an optional nickname when tracking a wallet, or
  rename one later via the pencil icon on its card.
- **Coin breakdown**: tap a Solana wallet card to expand it and see its
  actual token holdings with amounts and USD values (reuses the
  portfolio data already being fetched). Ethereum/Robinhood Chain don't
  have this yet - no holdings-lookup function built for those chains.
- **Activity filter**: filter chips above the wallet activity log let you
  view one wallet's transactions at a time instead of everything mixed
  together.

## Everything from this round: track record + remaining Stage 2 gaps

**Track record logging** — new "Run track record analysis" button in
Watchlist. Compares each scan's liquidity at scan time (now logged
automatically) against its current liquidity to see whether risk calls
actually held up: high-risk calls that later lost 80%+ liquidity
(correct), high-risk calls still healthy (possibly overcautious),
low-risk calls that lost liquidity (a real miss, worth knowing about),
and low-risk calls still healthy (correct). Only scans at least 6 hours
old are included, since outcomes need time to reveal themselves. This
runs on demand, not automatically, since it re-checks up to 15 scans at
once - manually triggered to keep API usage reasonable.

**Bundled wallet detection improved** — now checks whether multiple
"fresh" top holders were funded by the *same* source wallet, not just
counting low transaction history. Shared funding source is much stronger
bundling evidence than transaction count alone, and is flagged
separately with higher severity when found.

**Liquidity lock detection improved** — now recognizes Streamflow (a
real, confirmed locker program) by name when it's the LP holder, instead
of just saying "some program, unclear which."

**Deployer history extended to Ethereum/Robinhood Chain** — uses
Etherscan/Blockscout's direct contract-creator lookup (cleaner than the
Solana approach, which has to infer it from the genesis transaction) and
checks the deployer's recent transactions for other contract creations.

## Still open after this round

- Cross-device sync, push notifications, Reddit connection (all Stage 1,
  unchanged from before)
- Liquidity lock still can't detect tokens burned via a straight Burn
  instruction (no address to check for that case) and only recognizes
  one named locker (Streamflow) by program ID
- EVM coin breakdown for wallets (Ethereum/Robinhood Chain holdings by
  wallet) still not built - Solana only

## Live market data fix (stale market cap bug)

Real bug: watchlist entries only ever stored a market cap snapshot from
the moment they were scanned, and both the Watchlist card display and
the chat assistant were using that frozen number indefinitely - so
asking about a token scanned yesterday gave yesterday's market cap, even
when the actual current figure was very different.

Fixed: the existing 5-minute background re-check (which already re-scans
your 10 most recent watchlist entries for risk-level changes) now also
refreshes a live marketCapCurrent/liquidityUsdCurrent/priceUsdCurrent
field on each entry, timestamped with lastLiveCheckAt. The Watchlist
card now shows this live figure labeled "(live, X ago)" instead of the
frozen scan-time number, and the chat assistant is explicitly instructed
to prefer the live field over the scan-time snapshot when asked what a
token's market cap is right now.

Honest limit: this only covers your 10 most recently scanned tokens
(same bound as the existing risk re-check), and refreshes every 5
minutes, not truly real-time - that would need a paid websocket/streaming
data source. The original scan-time snapshot is still kept separately
and untouched, since track record analysis needs that fixed baseline to
compare against.

## X/Twitter monitoring - not built (deferred)

Investigated a Nitter-RSS-based approach with no API key needed, but
confirmed Nitter is effectively dead for this purpose - every public
instance currently has RSS disabled, since X cut off the guest-account
access Nitter relied on back in 2024. The only remaining free/keyless
option (X's own embed widgets) can show a specific account's timeline
but can't do hashtag search or sentiment analysis, since that needs
paid API access to read tweet text at all. Decision: parked until a
paid X API tier is reconsidered, rather than building a stripped-down
version now.

## Two-way sync across devices (Netlify Blobs)

New "Settings" section (accessible on both mobile and desktop now,
previously would have been desktop-only) shows a sync code. Enter that
same code on another device to link them - your wallets, watchlist,
alerts, and chat history sync automatically between any devices sharing
a code.

**How it works:** uses Netlify's own built-in storage (Netlify Blobs) -
no new signup, no separate database needed, works with your existing
Netlify account. Add `@netlify/blobs` to your dependencies (already in
package.json) and it works automatically on deploy.

**What kind of sync this actually is:** whole-state, last-write-wins,
not a field-level merge. Each device tracks when it last changed
something; every 60 seconds (and a few seconds after any local change)
it checks the other device's copy - whichever is newer wins, and the
older device adopts that full state. This reliably keeps two devices
caught up with each other for normal use (editing on one device at a
time). It is NOT a full conflict-resolution system - if you genuinely
edit both devices within the same few seconds before a sync completes,
the older change can be overwritten rather than merged. For how you'd
actually use this (checking your phone, then later your laptop), that's
not a real-world problem.

**Settings restructure:** since sync needs to be usable from any device,
Settings is no longer desktop-only - it's now a proper card-group
alongside Wallets/Watchlist/etc., visible in the mobile card stack too.
The wake-word toggle also moved here from inside the chat card (was
duplicated across mobile/desktop before with awkward syncing logic -
now there's just one).
