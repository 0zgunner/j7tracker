const {
  Keypair, Connection, LAMPORTS_PER_SOL, PublicKey,
  Transaction, SystemProgram, sendAndConfirmTransaction
} = require('@solana/web3.js');

const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache'
};

const DEVNET_RPC = 'https://api.devnet.solana.com';

// ---------------------------------------------------------------------
// Proves out the actual execution pipeline that real Stage 3 trading
// would eventually use - build a transaction, sign it, send it, wait
// for confirmation, return the real signature - but only ever against
// Solana's free devnet, with a private key that's generated fresh and
// never persisted anywhere. This validates the mechanics work
// end-to-end (RPC connectivity, transaction construction, signing,
// broadcast, confirmation) before that same logic would ever be
// pointed at a wallet holding real funds.
//
// This intentionally does a simple SOL transfer, not a token swap.
// Devnet doesn't have meaningful DEX liquidity for memecoin-style
// trading (Raydium/Jupiter pools that exist on mainnet mostly don't
// exist on devnet), so a devnet "swap test" wouldn't actually prove
// anything real about swap execution - only the underlying
// transaction-building and signing mechanics are testable here. Real
// swap-execution logic (slippage handling, route selection) would need
// its own testing approach later, separate from this wallet-mechanics
// proof.
// ---------------------------------------------------------------------

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { privateKey, toAddress, amountSol } = body;
  if (!privateKey || !toAddress || !amountSol) {
    return { statusCode: 400, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Missing "privateKey", "toAddress", or "amountSol"' }) };
  }
  if (amountSol <= 0 || amountSol > 5) {
    return { statusCode: 400, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'amountSol must be between 0 and 5 (devnet sanity cap)' }) };
  }

  try {
    const secretKey = Buffer.from(privateKey, 'base64');
    const fromKeypair = Keypair.fromSecretKey(secretKey);
    const toPubkey = new PublicKey(toAddress);
    const connection = new Connection(DEVNET_RPC, 'confirmed');

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey,
        lamports: Math.round(amountSol * LAMPORTS_PER_SOL)
      })
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [fromKeypair]);

    return {
      statusCode: 200,
      headers: NO_CACHE_HEADERS,
      body: JSON.stringify({
        network: 'devnet',
        signature,
        explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
        from: fromKeypair.publicKey.toBase58(),
        to: toAddress,
        amountSol,
        confirmedAt: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error('Devnet execution failed:', err.message);
    return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
