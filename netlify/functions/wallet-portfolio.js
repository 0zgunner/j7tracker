const fetch = require('node-fetch');

const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache'
};

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

function rpcUrl() {
  return `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
}

async function rpcCall(method, params) {
  const res = await fetch(rpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'RPC error');
  return data.result;
}

async function getSolBalance(address) {
  const result = await rpcCall('getBalance', [address]);
  return (result?.value || 0) / 1e9;
}

async function getTokenHoldings(address) {
  const result = await rpcCall('getTokenAccountsByOwner', [
    address,
    { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
    { encoding: 'jsonParsed' }
  ]);
  const accounts = result?.value || [];
  return accounts
    .map(acc => {
      const info = acc.account?.data?.parsed?.info;
      const amount = parseFloat(info?.tokenAmount?.uiAmountString || 0);
      return { mint: info?.mint, amount };
    })
    .filter(h => h.mint && h.amount > 0);
}

async function getPrices(mints) {
  if (mints.length === 0) return {};
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mints.join(',')}`);
    const data = await res.json();
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];
    const priceByMint = {};
    pairs.forEach(p => {
      const addr = p.baseToken?.address;
      if (!addr) return;
      const liq = p.liquidity?.usd || 0;
      if (!priceByMint[addr] || liq > priceByMint[addr].liq) {
        priceByMint[addr] = { price: parseFloat(p.priceUsd || 0), symbol: p.baseToken?.symbol, liq };
      }
    });
    return priceByMint;
  } catch (err) {
    console.error('Price lookup failed:', err.message);
    return {};
  }
}

exports.handler = async (event) => {
  if (!HELIUS_KEY) {
    return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'HELIUS_API_KEY not configured' }) };
  }

  const address = event.queryStringParameters?.address;
  if (!address) {
    return { statusCode: 400, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Missing required "address" parameter' }) };
  }

  try {
    const [solBalance, holdings] = await Promise.all([
      getSolBalance(address),
      getTokenHoldings(address)
    ]);

    // Only price-check the largest handful of holdings to keep this fast -
    // dust balances rarely matter for a portfolio total anyway.
    const topHoldings = holdings.sort((a, b) => b.amount - a.amount).slice(0, 15);
    const prices = await getPrices(topHoldings.map(h => h.mint));

    const solPriceRes = await fetch('https://api.dexscreener.com/latest/dex/pairs/solana/58oqchx4ywmvkdwllzzbi4chocc2fqcuwbkwmihlyqo2');
    const solPriceData = await solPriceRes.json();
    const solPrice = parseFloat(solPriceData?.pair?.priceUsd || solPriceData?.pairs?.[0]?.priceUsd || 0);

    const solValueUsd = solBalance * solPrice;

    const priced = topHoldings
      .filter(h => h.mint !== WRAPPED_SOL_MINT && prices[h.mint])
      .map(h => ({
        mint: h.mint,
        symbol: prices[h.mint].symbol,
        amount: h.amount,
        priceUsd: prices[h.mint].price,
        valueUsd: h.amount * prices[h.mint].price
      }))
      .sort((a, b) => b.valueUsd - a.valueUsd);

    const tokensValueUsd = priced.reduce((sum, p) => sum + p.valueUsd, 0);
    const totalValueUsd = solValueUsd + tokensValueUsd;

    return {
      statusCode: 200,
      headers: NO_CACHE_HEADERS,
      body: JSON.stringify({
        address,
        solBalance,
        solValueUsd,
        totalValueUsd,
        topHoldings: priced.slice(0, 8),
        uncalculatedHoldingsCount: Math.max(0, holdings.length - topHoldings.length),
        fetchedAt: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error('Portfolio fetch failed:', err.message);
    return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
