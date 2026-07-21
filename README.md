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
Groq. Won't give direct buy/sell advice; explains risk factors and leaves
the decision to you.

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
