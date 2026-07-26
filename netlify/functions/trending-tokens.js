const fetch = require('node-fetch');

// Prevents stale cached trending data.
const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache'
};

// DexScreener's free "latest boosted tokens" endpoint - real teams paying
// for visibility right now, which is a reasonable proxy for "what's
// currently getting attention" on Solana. No API key required.
const BOOSTS_URL = 'https://api.dexscreener.com/token-boosts/latest/v1';

async function getBoostedSolanaAddresses() {
  try {
    const res = await fetch(BOOSTS_URL);
    const data = await res.json();
    const items = Array.isArray(data) ? data : [];
    return items
      .filter(item => item.chainId === 'solana')
      .slice(0, 15)
      .map(item => item.tokenAddress);
  } catch (err) {
    console.error('Boosted tokens fetch failed:', err.message);
    return [];
  }
}

async function getTokenDetails(addresses) {
  if (addresses.length === 0) return [];
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addresses.join(',')}`);
    const data = await res.json();
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];

    // Keep the highest-liquidity pair per token address
    const byToken = {};
    pairs.forEach(p => {
      const addr = p.baseToken?.address;
      if (!addr) return;
      if (!byToken[addr] || (p.liquidity?.usd || 0) > (byToken[addr].liquidity?.usd || 0)) {
        byToken[addr] = p;
      }
    });

    return Object.values(byToken).map(p => ({
      name: p.baseToken?.name,
      symbol: p.baseToken?.symbol,
      address: p.baseToken?.address,
      priceUsd: p.priceUsd,
      marketCap: p.marketCap || p.fdv || null,
      liquidityUsd: p.liquidity?.usd || 0,
      volume24h: p.volume?.h24 || 0,
      priceChange24h: p.priceChange?.h24 || null,
      pairAddress: p.pairAddress,
      dexId: p.dexId
    }));
  } catch (err) {
    console.error('Token details fetch failed:', err.message);
    return [];
  }
}

exports.handler = async () => {
  try {
    const addresses = await getBoostedSolanaAddresses();
    const tokens = await getTokenDetails(addresses);

    // Sort by 24h volume as a simple "actually being traded" filter,
    // since boosted alone can just mean paid promotion.
    tokens.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));

    return {
      statusCode: 200,
      headers: NO_CACHE_HEADERS,
      body: JSON.stringify({
        tokens: tokens.slice(0, 10),
        fetchedAt: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error('Trending tokens handler failed:', err.message);
    return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ tokens: [], error: err.message }) };
  }
};
