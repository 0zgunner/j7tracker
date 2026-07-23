const fetch = require('node-fetch');

// Prevents browsers/CDNs from silently serving a stale cached response.
const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache'
};

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

function formatAgo(timestampSeconds) {
  const diff = Math.floor(Date.now() / 1000) - timestampSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

async function getWalletTxs(address) {
  // Note: Helius's Enhanced Transactions endpoint is in maintenance mode
  // (no new features, but still functional). If it's ever fully retired,
  // switch to the getTransactionsForAddress RPC method instead.
  const url = `https://api-mainnet.helius-rpc.com/v0/addresses/${address}/transactions?api-key=${HELIUS_KEY}&limit=8`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error(`Helius fetch failed for ${address}:`, err.message);
    return [];
  }
}

// Pull out the non-SOL token mint the wallet received in this tx, if any -
// this is what lets the frontend offer a "scan this token" tap on the signal.
function extractBoughtToken(tx, address) {
  const transfers = tx.tokenTransfers || [];
  const received = transfers.find(t =>
    t.toUserAccount?.toLowerCase() === address.toLowerCase() &&
    t.mint && t.mint !== WRAPPED_SOL_MINT
  );
  if (!received) return null;
  return { mint: received.mint, amount: received.tokenAmount };
}

exports.handler = async (event) => {
  if (!HELIUS_KEY) {
    return {
      statusCode: 200,
      headers: NO_CACHE_HEADERS,
      body: JSON.stringify({ signals: [], error: 'HELIUS_API_KEY not configured' })
    };
  }

  const addrs = (event.queryStringParameters?.addrs || '')
    .split(',')
    .map(a => a.trim())
    .filter(Boolean);

  if (addrs.length === 0) {
    return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ signals: [] }) };
  }

  const signals = [];
  for (const addr of addrs) {
    const txs = await getWalletTxs(addr);
    txs.forEach(tx => {
      const description = tx.description || `${tx.type || 'transaction'} on Solana`;
      const bought = extractBoughtToken(tx, addr);
      signals.push({
        chain: 'solana',
        type: 'wallet',
        title: `${addr.slice(0, 4)}...${addr.slice(-4)}: ${description}`,
        subtitle: tx.source ? `via ${tx.source}` : 'Solana mainnet',
        timestamp: new Date(tx.timestamp * 1000).toISOString(),
        boughtMint: bought?.mint || null,
        boughtAmount: bought?.amount || null
      });
    });
  }

  signals.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return {
    statusCode: 200,
    headers: NO_CACHE_HEADERS,
    body: JSON.stringify({ signals: signals.slice(0, 15) })
  };
};
