const fetch = require('node-fetch');

// Prevents browsers/CDNs from silently serving a stale cached response.
const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache'
};

const SUBREDDITS = ['CryptoCurrency', 'Bitcoin', 'ethereum', 'solana'];
const USER_AGENT = process.env.REDDIT_USER_AGENT || 'J7Tracker/1.0 (by /u/j7tracker)';
const CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;

const KEYWORDS = [
  'Bitcoin', 'BTC', 'Ethereum', 'ETH', 'Solana', 'SOL', 'Robinhood Chain',
  'layer 2', 'L2', 'rollup', 'DeFi', 'NFT', 'staking', 'halving', 'ETF',
  'regulation', 'SEC', 'memecoin', 'pump', 'dump', 'ATH'
];

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT
    },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Reddit auth failed: ' + JSON.stringify(data));
  }
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function getTrendingPosts(subreddit, token) {
  try {
    const res = await fetch(`https://oauth.reddit.com/r/${subreddit}/hot?limit=15`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': USER_AGENT
      }
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
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return {
      statusCode: 200,
      headers: NO_CACHE_HEADERS,
      body: JSON.stringify({
        trends: [], signals: [],
        error: 'REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not configured'
      })
    };
  }

  try {
    const token = await getAccessToken();

    const allPosts = [];
    for (const sub of SUBREDDITS) {
      const posts = await getTrendingPosts(sub, token);
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
      headers: NO_CACHE_HEADERS,
      body: JSON.stringify({ trends, signals })
    };
  } catch (err) {
    console.error('Reddit handler error:', err.message);
    return {
      statusCode: 200,
      headers: NO_CACHE_HEADERS,
      body: JSON.stringify({ trends: [], signals: [], error: err.message })
    };
  }
};
