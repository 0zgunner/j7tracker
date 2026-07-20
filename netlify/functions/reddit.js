const fetch = require('node-fetch');

const SUBREDDITS = ['CryptoCurrency', 'Bitcoin', 'ethereum', 'solana'];
const USER_AGENT = process.env.REDDIT_USER_AGENT || 'J7Tracker/1.0';

const KEYWORDS = [
  'Bitcoin', 'BTC', 'Ethereum', 'ETH', 'Solana', 'SOL', 'Robinhood Chain',
  'layer 2', 'L2', 'rollup', 'DeFi', 'NFT', 'staking', 'halving', 'ETF',
  'regulation', 'SEC', 'memecoin', 'pump', 'dump', 'ATH'
];

async function getTrendingPosts(subreddit) {
  try {
    const res = await fetch(`https://www.reddit.com/r/${subreddit}/hot.json?limit=15`, {
      headers: { 'User-Agent': USER_AGENT }
    });
    const data = await res.json();
    return data.data?.children || [];
  } catch (err) {
    console.error(`Reddit fetch failed for r/${subreddit}:`, err.message);
    return [];
  }
}

function extractTrends(posts) {
  const mentions = {};
  posts.forEach(post => {
    const title = (post.data.title || '').toLowerCase();
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
  const allPosts = [];
  for (const sub of SUBREDDITS) {
    const posts = await getTrendingPosts(sub);
    allPosts.push(...posts);
  }

  const trends = extractTrends(allPosts);

  const signals = allPosts
    .sort((a, b) => b.data.score - a.data.score)
    .slice(0, 8)
    .map(post => ({
      type: 'reddit',
      title: post.data.title.slice(0, 110),
      subtitle: `r/${post.data.subreddit} · ${post.data.score} upvotes`,
      timestamp: new Date(post.data.created_utc * 1000).toISOString(),
      ago: `${Math.floor((Date.now() / 1000 - post.data.created_utc) / 60)}m ago`
    }));

  return {
    statusCode: 200,
    body: JSON.stringify({ trends, signals })
  };
};
