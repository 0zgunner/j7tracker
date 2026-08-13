const fetch = require('node-fetch');
const { PublicKey } = require('@solana/web3.js');

const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache'
};

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

function rpcUrl() {
  return `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
}

async function rpcCall(method, params) {
  const res = await fetch(rpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'RPC error');
  return data.result;
}

// Every SPL token has an associated Metaplex metadata account at this
// deterministic address, regardless of whether the token was ever
// boosted or promoted anywhere - this is the actual source of truth for
// what the deployer wrote about their own token.
function findMetadataPda(mint) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  );
  return pda;
}

// Minimal manual Borsh decoder for just the fields we need (name, symbol,
// uri) from a Metaplex Metadata V1 account. Layout: 1 byte key + 32 byte
// update authority + 32 byte mint, then three Borsh strings (4-byte LE
// length prefix + UTF8 bytes) for name, symbol, uri in that order.
function decodeMetadataAccount(buffer) {
  let offset = 1 + 32 + 32; // skip key, update authority, mint

  function readString() {
    const len = buffer.readUInt32LE(offset);
    offset += 4;
    const str = buffer.slice(offset, offset + len).toString('utf8').replace(/\0/g, '').trim();
    offset += len;
    return str;
  }

  const name = readString();
  const symbol = readString();
  const uri = readString();
  return { name, symbol, uri };
}

async function getOnChainMetadata(mintAddress) {
  const mint = new PublicKey(mintAddress);
  const pda = findMetadataPda(mint);
  const accountInfo = await rpcCall('getAccountInfo', [pda.toBase58(), { encoding: 'base64' }]);
  if (!accountInfo?.value?.data?.[0]) return null;
  const buffer = Buffer.from(accountInfo.value.data[0], 'base64');
  return decodeMetadataAccount(buffer);
}

async function getOffChainMetadata(uri) {
  if (!uri) return null;
  try {
    // URIs are typically IPFS or Arweave links, both fetchable directly
    // as plain HTTP(S) URLs by the hosting gateway.
    const res = await fetch(uri, { timeout: 8000 });
    const data = await res.json();
    return {
      description: data.description || null,
      image: data.image || null,
      twitter: data.twitter || data.extensions?.twitter || null,
      telegram: data.telegram || data.extensions?.telegram || null,
      website: data.website || data.extensions?.website || null
    };
  } catch (err) {
    console.error('Off-chain metadata fetch failed:', err.message);
    return null;
  }
}

exports.handler = async (event) => {
  if (!HELIUS_KEY) {
    return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'HELIUS_API_KEY not configured' }) };
  }

  const mint = event.queryStringParameters?.mint;
  if (!mint) {
    return { statusCode: 400, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Missing required "mint" parameter' }) };
  }

  try {
    const onChain = await getOnChainMetadata(mint);
    if (!onChain) {
      return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'No metadata account found for this mint' }) };
    }

    const offChain = await getOffChainMetadata(onChain.uri);

    return {
      statusCode: 200,
      headers: NO_CACHE_HEADERS,
      body: JSON.stringify({
        mint,
        name: onChain.name,
        symbol: onChain.symbol,
        description: offChain?.description || null,
        image: offChain?.image || null,
        twitter: offChain?.twitter || null,
        telegram: offChain?.telegram || null,
        website: offChain?.website || null,
        fetchedAt: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error('Token narrative fetch failed:', err.message);
    return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
