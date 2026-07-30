const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache'
};

exports.handler = async () => {
  const key = process.env.VAPID_PUBLIC_KEY || null;
  return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ publicKey: key }) };
};
