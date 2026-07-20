const fetch = require('node-fetch');

const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY;
const ETHERSCAN_URL = 'https://api.etherscan.io/api';

function formatAgo(timestamp) {
  const diff = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

async function getWalletTxs(address) {
  const url = `${ETHERSCAN_URL}?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&sort=desc&apikey=${ETHERSCAN_KEY}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return Array.isArray(data.result) ? data.result.slice(0, 8) : [];
  } catch (err) {
    console.error(`Etherscan fetch failed for ${address}:`, err.message);
    return [];
  }
}

exports.handler = async (event) => {
  if (!ETHERSCAN_KEY) {
    return {
      statusCode: 200,
      body: JSON.stringify({ signals: [], error: 'ETHERSCAN_API_KEY not configured' })
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
      const valueEth = parseFloat(tx.value) / 1e18;
      if (valueEth <= 0) return;
      const direction = tx.from?.toLowerCase() === addr.toLowerCase() ? 'sent' : 'received';
      signals.push({
        chain: 'ethereum',
        type: 'wallet',
        title: `${addr.slice(0, 6)}...${addr.slice(-4)} ${direction} ${valueEth.toFixed(3)} ETH`,
        subtitle: `block ${tx.blockNumber} · gas used ${tx.gasUsed}`,
        timestamp: new Date(parseInt(tx.timeStamp, 10) * 1000).toISOString(),
        ago: formatAgo(tx.timeStamp)
      });
    });
  }

  signals.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return {
    statusCode: 200,
    body: JSON.stringify({ signals: signals.slice(0, 15) })
  };
};
