const { Keypair, Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');

const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache'
};

const DEVNET_RPC = 'https://api.devnet.solana.com';

// ---------------------------------------------------------------------
// Solana devnet is a free public test network - its SOL has zero real
// value and can't be moved to mainnet. This exists purely to prove out
// the execution mechanics (generate a wallet, sign a transaction, send
// it, confirm it) safely, before that logic is ever pointed at a real
// wallet with real funds. The private key is generated fresh on each
// call and returned once - it is never stored anywhere server-side.
// ---------------------------------------------------------------------

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toBase58();
    const privateKey = Buffer.from(keypair.secretKey).toString('base64');

    let airdropSignature = null;
    let airdropError = null;
    const body = JSON.parse(event.body || '{}');
    if (body.requestAirdrop) {
      try {
        const connection = new Connection(DEVNET_RPC, 'confirmed');
        // 1 devnet SOL - plenty for testing transfer mechanics, devnet
        // faucets are often rate-limited so this can occasionally fail.
        airdropSignature = await connection.requestAirdrop(keypair.publicKey, LAMPORTS_PER_SOL);
        await connection.confirmTransaction(airdropSignature, 'confirmed');
      } catch (err) {
        airdropError = 'Devnet faucet request failed (often rate-limited) - you can retry, or fund this address manually from a devnet faucet website using the public key below.';
        console.error('Devnet airdrop failed:', err.message);
      }
    }

    return {
      statusCode: 200,
      headers: NO_CACHE_HEADERS,
      body: JSON.stringify({
        network: 'devnet',
        publicKey,
        privateKey,
        warning: 'This is a DEVNET-ONLY test wallet with zero real value. Never reuse this key pair or any key generated this way for a mainnet wallet holding real funds.',
        airdropSignature,
        airdropError
      })
    };
  } catch (err) {
    console.error('Devnet wallet generation failed:', err.message);
    return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
