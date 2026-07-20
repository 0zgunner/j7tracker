# J7Tracker

Tracks wallet activity across Ethereum, Robinhood Chain, and Solana, plus
crypto trend signals from Reddit and free news RSS feeds. Read-only — no
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

   - **Etherscan** (Ethereum tracking) — sign up at etherscan.io, go to your
     account, click API Keys, create one.
   - **Helius** (Solana tracking) — sign up at helius.dev, create a free
     project, copy the API key from the dashboard.
   - **Reddit** — no key needed for the public read-only endpoints this app
     uses.
   - **Robinhood Chain** — no key needed; it uses the public Blockscout
     explorer API at robinhoodchain.blockscout.com.
   - **News** — no key needed; pulls free RSS feeds from CoinDesk and
     Cointelegraph directly. (CryptoPanic's free API tier was discontinued
     April 2026, so this app doesn't use it.)

4. **Copy `.env.example` to `.env`** and fill in your keys:
   ```
   cp .env.example .env
   ```

5. **Run locally:**
   ```
   netlify dev
   ```
   This starts the site with working Functions at http://localhost:8888.

## Deploying to Netlify

1. Push this folder to a GitHub repo.
2. In Netlify: New site from Git, select the repo.
3. Build settings are already set in `netlify.toml` (publish: `public`,
   functions: `netlify/functions`) — no changes needed.
4. In Site settings, Environment variables, add the same keys from your
   `.env` file (ETHERSCAN_API_KEY, HELIUS_API_KEY). Never commit `.env`
   to the repo — it's already in `.gitignore`.
5. Deploy.

## Project structure

```
public/              static frontend (index.html, app.js, styles.css)
netlify/functions/   serverless functions, one per data source
  wallets-eth.js        Ethereum wallet activity (Etherscan)
  wallets-robinhood.js  Robinhood Chain wallet activity (Blockscout)
  wallets-solana.js     Solana wallet activity (Helius)
  reddit.js             Reddit trend signals
  news.js               News + trend signals (CoinDesk/Cointelegraph RSS, no key)
```

## Stage 2: Token risk scanner (Solana)

Paste a Solana token mint address into "Check a Solana token" to scan it for:
- Active mint authority (deployer can create unlimited new tokens)
- Active freeze authority (deployer can block holders from selling)
- Top-10 holder concentration (how much supply a few wallets control)
- Token-2022 "backdoor" extensions — permanent delegate, transfer hook,
  transfer fee, default frozen state (Solana's closest equivalent to a
  malicious smart contract function, since standard SPL tokens don't have
  custom bytecode the way Ethereum contracts do)
- Liquidity depth (via DexScreener, free, no key) — thin liquidity means
  a token is easy to manipulate or rug
- Volume-to-liquidity ratio and buy/sell skew — flags potential wash
  trading or one-sided activity

Results appear as a risk badge (low/medium/high) in the token check panel,
get logged to the signal log, and are saved to your Watchlist panel. Uses
the same Helius key already configured, plus DexScreener's free public API
— no additional API key needed for either.

This is a heuristic check, not a guarantee. It doesn't catch every scam
pattern (e.g. some honeypot contracts still allow selling for the deployer
while trapping other holders in ways this scan doesn't detect). Always
treat it as one input, not a final answer.

## Notes

- Watched wallet addresses are stored in the browser only (localStorage),
  not on any server.
- Data refreshes every 5 minutes automatically.
- This is Stage 1 (tracking only). No wallet with a private key is created
  or used by this app — it only reads public on-chain and social data.
