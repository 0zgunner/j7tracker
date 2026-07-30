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
  const store = getStore({ name: 'j7tracker-push-subs', consistency: 'strong' });

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }
    const { code, subscription } = body;
    if (!isValidCode(code) || !subscription?.endpoint) {
      return { statusCode: 400, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Missing or invalid "code"/"subscription"' }) };
    }
    try {
      await store.setJSON(code, subscription);
      return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      console.error('Push subscribe failed:', err.message);
      return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: err.message }) };
    }
  }

  if (event.httpMethod === 'DELETE') {
    const code = event.queryStringParameters?.code;
    if (!isValidCode(code)) {
      return { statusCode: 400, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Invalid sync code' }) };
    }
    try {
      await store.delete(code);
      return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
};
