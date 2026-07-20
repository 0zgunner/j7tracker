const fetch = require('node-fetch');

const HELIUS_KEY = process.env.HELIUS_API_KEY;

function formatAgo(timestampSeconds) {
  const diff = Math.floor(Date.now() / 1000) - timestampSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

async function getWalletTxs(address) {
  const url = `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${HELIUS_KEY}&limit=8`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error(`Helius fetch failed for ${address}:`, err.message);
    return [];
  }
}

exports.handler = async (event) => {
  if (!HELIUS_KEY) {
    return {
      statusCode: 200,
      body: JSON.stringify({ signals: [], error: 'HELIUS_API_KEY not configured' })
    };
  }

  const addrs = (event.queryStringParameters?.addrs || '')
    .split(',')
    .map(a => a.trim())
    .filter(Boolean);

  if (addrs.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ signals: [] }) };
  }

  const signals = [];
  for (const addr of addrs) {
    const txs = await getWalletTxs(addr);
    txs.forEach(tx => {
      const description = tx.description || `${tx.type || 'transaction'} on Solana`;
      signals.push({
        chain: 'solana',
        type: 'wallet',
        title: `${addr.slice(0, 4)}...${addr.slice(-4)}: ${description}`,
        subtitle: tx.source ? `via ${tx.source}` : 'Solana mainnet',
        timestamp: new Date(tx.timestamp * 1000).toISOString(),
        ago: formatAgo(tx.timestamp)
      });
    });
  }

  signals.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return {
    statusCode: 200,
    body: JSON.stringify({ signals: signals.slice(0, 15) })
  };
};
