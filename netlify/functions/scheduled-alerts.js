const webpush = require('web-push');
const { getStore } = require('@netlify/blobs');
const fetch = require('node-fetch');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SITE_URL = process.env.URL; // Netlify provides this automatically

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails('mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

async function checkTokenRisk(mint, chain) {
  try {
    const url = chain === 'solana'
      ? `${SITE_URL}/.netlify/functions/token-risk?mint=${mint}`
      : `${SITE_URL}/.netlify/functions/token-risk-evm?address=${mint}&chain=${chain}`;
    const res = await fetch(url);
    return await res.json();
  } catch (err) {
    console.error('Scheduled risk check failed for a token:', err.message);
    return null;
  }
}

// Runs periodically (see netlify.toml schedule). For every device that
// has both synced data and a push subscription registered, re-checks its
// most recent watchlist entries for risk-level changes and sends a real
// push notification - this is what makes alerts reach you even with the
// browser fully closed, unlike the in-app-only check that only runs
// while a tab is open.
exports.handler = async () => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log('VAPID keys not configured - skipping scheduled push check.');
    return { statusCode: 200, body: 'skipped: no VAPID keys' };
  }

  const subStore = getStore({ name: 'j7tracker-push-subs', consistency: 'strong' });
  const syncStore = getStore({ name: 'j7tracker-sync', consistency: 'strong' });

  let subKeys;
  try {
    const listing = await subStore.list();
    subKeys = (listing.blobs || []).map(b => b.key);
  } catch (err) {
    console.error('Could not list push subscriptions:', err.message);
    return { statusCode: 200, body: 'error listing subscriptions' };
  }

  for (const code of subKeys) {
    try {
      const subscription = await subStore.get(code, { type: 'json' });
      const syncedData = await syncStore.get(code, { type: 'json' });
      if (!subscription || !syncedData?.watchlist) continue;

      const toCheck = syncedData.watchlist.slice(0, 5); // keep this light - it runs for every registered device
      for (const entry of toCheck) {
        const chain = entry.chain || 'solana';
        const result = await checkTokenRisk(entry.mint, chain);
        if (!result || result.error || !result.level) continue;

        if (result.level !== entry.level) {
          const short = entry.mint.slice(0, 6) + '...' + entry.mint.slice(-4);
          const payload = JSON.stringify({
            title: 'J7Tracker risk alert',
            body: `${short} risk changed: ${entry.level} → ${result.level}`
          });
          try {
            await webpush.sendNotification(subscription, payload);
          } catch (pushErr) {
            console.error(`Push send failed for ${code}:`, pushErr.message);
            // A 410 Gone means the subscription is dead - clean it up.
            if (pushErr.statusCode === 410) {
              await subStore.delete(code);
            }
          }
        }
      }
    } catch (err) {
      console.error(`Scheduled check failed for sync code ${code}:`, err.message);
    }
  }

  return { statusCode: 200, body: 'ok' };
};
