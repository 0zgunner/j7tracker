const fetch = require('node-fetch');

// Prevents browsers/CDNs from silently serving a stale cached response.
const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache'
};

// Blockscout exposes an Etherscan-compatible API, no key required for
// moderate use. If this gets rate limited, an API key can be added as
// a query param once Blockscout issues one for this instance.
const EXPLORER_URL = 'https://robinhoodchain.blockscout.com/api';

function formatAgo(timestamp) {
  const diff = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

async function getWalletTxs(address) {
  const url = `${EXPLORER_URL}?module=account&action=txlist&address=${address}&sort=desc`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return Array.isArray(data.result) ? data.result.slice(0, 8) : [];
  } catch (err) {
    console.error(`Robinhood Chain fetch failed for ${address}:`, err.message);
    return [];
  }
}

exports.handler = async (event) => {
  const addrs = (event.queryStringParameters?.addrs || '')
    .split(',')
    .map(a => a.trim())
    .filter(Boolean);

  if (addrs.length === 0) {
    return { statusCode: 200,
 headers: NO_CACHE_HEADERS, body: JSON.stringify({ signals: [] }) };
  }

  const signals = [];
  for (const addr of addrs) {
    const txs = await getWalletTxs(addr);
    txs.forEach(tx => {
      const valueEth = parseFloat(tx.value) / 1e18;
      if (valueEth <= 0) return;
      const direction = tx.from?.toLowerCase() === addr.toLowerCase() ? 'sent' : 'received';
      signals.push({
        chain: 'robinhood',
        type: 'wallet',
        title: `${addr.slice(0, 6)}...${addr.slice(-4)} ${direction} ${valueEth.toFixed(3)} ETH on Robinhood Chain`,
        subtitle: `block ${tx.blockNumber}`,
        timestamp: new Date(parseInt(tx.timeStamp, 10) * 1000).toISOString()
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
