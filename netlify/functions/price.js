const fetch = require('node-fetch');

// Prevents stale cached price data.
const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache'
};

// Same established SOL/USDC pair used for the general Solana chart.
const SOL_USDC_PAIR = '58oqchx4ywmvkdwllzzbi4chocc2fqcuwbkwmihlyqo2';

exports.handler = async () => {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${SOL_USDC_PAIR}`);
    const data = await res.json();
    const pair = data?.pair || data?.pairs?.[0];
    if (!pair) {
      return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'No pair data found' }) };
    }
    return {
      statusCode: 200,
      headers: NO_CACHE_HEADERS,
      body: JSON.stringify({
        solPriceUsd: pair.priceUsd,
        priceChange24h: pair.priceChange?.h24,
        fetchedAt: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error('Price fetch failed:', err.message);
    return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
