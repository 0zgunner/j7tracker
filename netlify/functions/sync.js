const { getStore } = require('@netlify/blobs');

const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache'
};

function isValidCode(code) {
  return typeof code === 'string' && /^[A-Z0-9]{6,10}$/.test(code);
}

exports.handler = async (event) => {
  const store = getStore({ name: 'j7tracker-sync', consistency: 'strong' });

  if (event.httpMethod === 'GET') {
    const code = event.queryStringParameters?.code;
    if (!isValidCode(code)) {
      return { statusCode: 400, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Invalid sync code' }) };
    }
    try {
      const data = await store.get(code, { type: 'json' });
      return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ data: data || null }) };
    } catch (err) {
      console.error('Sync pull failed:', err.message);
      return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ data: null }) };
    }
  }

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }
    const { code, data } = body;
    if (!isValidCode(code) || !data) {
      return { statusCode: 400, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Missing or invalid "code"/"data"' }) };
    }
    // Cap stored size defensively - this is meant for one person's app
    // state, not arbitrary uploads.
    const serialized = JSON.stringify(data);
    if (serialized.length > 2_000_000) {
      return { statusCode: 400, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Data too large to sync' }) };
    }
    try {
      await store.setJSON(code, data);
      return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      console.error('Sync push failed:', err.message);
      return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
};
