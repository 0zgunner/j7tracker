const fetch = require('node-fetch');

// Free RSS feeds, no API key or account required.
const FEEDS = [
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' }
];

const KEYWORDS = [
  'Bitcoin', 'BTC', 'Ethereum', 'ETH', 'Solana', 'SOL', 'Robinhood Chain',
  'layer 2', 'L2', 'rollup', 'DeFi', 'NFT', 'staking', 'halving', 'ETF',
  'regulation', 'SEC', 'memecoin', 'stablecoin'
];

function formatAgo(pubDate) {
  const diff = Math.floor((Date.now() - new Date(pubDate).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function parseRssItems(xml, sourceName) {
  const items = [];
  const itemBlocks = xml.split('<item>').slice(1);
  itemBlocks.forEach(block => {
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const dateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    if (!titleMatch) return;
    const title = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const pubDate = dateMatch ? dateMatch[1].trim() : new Date().toUTCString();
    items.push({ title, source: sourceName, pubDate });
  });
  return items;
}

async function getFeedItems(feed) {
  try {
    const res = await fetch(feed.url, { headers: { 'User-Agent': 'J7Tracker/1.0' } });
    const xml = await res.text();
    return parseRssItems(xml, feed.name).slice(0, 15);
  } catch (err) {
    console.error(`RSS fetch failed for ${feed.name}:`, err.message);
    return [];
  }
}

function extractTrends(items) {
  const mentions = {};
  items.forEach(item => {
    const title = item.title.toLowerCase();
    KEYWORDS.forEach(kw => {
      if (title.includes(kw.toLowerCase())) {
        mentions[kw] = (mentions[kw] || 0) + 1;
      }
    });
  });
  return Object.entries(mentions)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

exports.handler = async () => {
  const allItems = [];
  for (const feed of FEEDS) {
    const items = await getFeedItems(feed);
    allItems.push(...items);
  }

  const trending = extractTrends(allItems);

  const news = allItems
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
    .slice(0, 12)
    .map(item => ({
      type: 'news',
      title: item.title,
      subtitle: item.source,
      timestamp: new Date(item.pubDate).toISOString(),
      ago: formatAgo(item.pubDate)
    }));

  return {
    statusCode: 200,
    body: JSON.stringify({ news, trending })
  };
};
