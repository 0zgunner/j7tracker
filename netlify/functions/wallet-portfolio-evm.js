const fetch = require('node-fetch');

const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache'
};

const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY;

const CHAIN_CONFIG = {
  ethereum: { explorerUrl: 'https://api.etherscan.io/api', apiKeyParam: () => `&apikey=${ETHERSCAN_KEY}` },
  robinhood: { explorerUrl: 'https://robinhoodchain.blockscout.com/api', apiKeyParam: () => '' }
};

async function getNativeBalance(chain, address) {
  const cfg = CHAIN_CONFIG[chain];
  try {
    const url = `${cfg.explorerUrl}?module=account&action=balance&address=${address}${cfg.apiKeyParam()}`;
    const res = await fetch(url);
    const data = await res.json();
    return parseFloat(data.result || 0) / 1e18;
  } catch (err) {
    console.error('Native balance fetch failed:', err.message);
    return 0;
  }
}

// Robinhood Chain (Blockscout) exposes current token balances directly -
// the reliable path.
async function getBlockscoutTokenBalances(address) {
  try {
    const res = await fetch(`https://robinhoodchain.blockscout.com/api/v2/addresses/${address}/token-balances`);
    const data = await res.json();
    const items = Array.isArray(data) ? data : [];
    return items
      .map(item => {
        const decimals = parseInt(item.token?.decimals || '18', 10);
        const raw = parseFloat(item.value || 0);
        return {
          contract: item.token?.address,
          symbol: item.token?.symbol,
          amount: raw / Math.pow(10, decimals)
        };
      })
      .filter(t => t.contract && t.amount > 0);
  } catch (err) {
    console.error('Blockscout token balances fetch failed:', err.message);
    return [];
  }
}

// Etherscan's free tier has no "all current balances" endpoint, so this
// derives approximate holdings from the ERC-20 transfer history instead:
// sum inbound minus outbound per token. This is a real, honest limitation
// - very old activity beyond what we paginate through could be missed,
// and a wallet with thousands of transfers won't get a perfectly exact
// balance this way. It's a reasonable approximation, not a guarantee.
async function getEtherscanTokenBalances(address) {
  const cfg = CHAIN_CONFIG.ethereum;
  try {
    const url = `${cfg.explorerUrl}?module=account&action=tokentx&address=${address}&sort=desc&page=1&offset=1000${cfg.apiKeyParam()}`;
    const res = await fetch(url);
    const data = await res.json();
    const transfers = Array.isArray(data.result) ? data.result : [];

    const balances = {};
    transfers.forEach(tx => {
      const contract = tx.contractAddress;
      if (!contract) return;
      const decimals = parseInt(tx.tokenDecimal || '18', 10);
      const amount = parseFloat(tx.value || 0) / Math.pow(10, decimals);
      if (!balances[contract]) balances[contract] = { symbol: tx.tokenSymbol, amount: 0 };
      if (tx.to?.toLowerCase() === address.toLowerCase()) balances[contract].amount += amount;
      if (tx.from?.toLowerCase() === address.toLowerCase()) balances[contract].amount -= amount;
    });

    return Object.entries(balances)
      .map(([contract, info]) => ({ contract, symbol: info.symbol, amount: info.amount }))
      .filter(t => t.amount > 0.0001);
  } catch (err) {
    console.error('Etherscan token transfer history fetch failed:', err.message);
    return [];
  }
}

async function getPrices(contracts) {
  if (contracts.length === 0) return {};
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${contracts.join(',')}`);
    const data = await res.json();
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];
    const priceByContract = {};
    pairs.forEach(p => {
      const addr = p.baseToken?.address?.toLowerCase();
      if (!addr) return;
      const liq = p.liquidity?.usd || 0;
      if (!priceByContract[addr] || liq > priceByContract[addr].liq) {
        priceByContract[addr] = { price: parseFloat(p.priceUsd || 0), liq };
      }
    });
    return priceByContract;
  } catch (err) {
    console.error('Price lookup failed:', err.message);
    return {};
  }
}

exports.handler = async (event) => {
  const address = event.queryStringParameters?.address;
  const chain = event.queryStringParameters?.chain;
  if (!address || !CHAIN_CONFIG[chain]) {
    return { statusCode: 400, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Missing or invalid "address"/"chain"' }) };
  }
  if (chain === 'ethereum' && !ETHERSCAN_KEY) {
    return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'ETHERSCAN_API_KEY not configured' }) };
  }

  try {
    const [nativeBalance, holdings] = await Promise.all([
      getNativeBalance(chain, address),
      chain === 'robinhood' ? getBlockscoutTokenBalances(address) : getEtherscanTokenBalances(address)
    ]);

    const topHoldings = holdings.sort((a, b) => b.amount - a.amount).slice(0, 15);
    const contracts = topHoldings.map(h => h.contract).filter(Boolean);
    const prices = await getPrices(contracts);

    // Native currency price via DexScreener isn't reliable to fetch generically
    // here, so native value is reported in native units only, not USD, unless
    // wrapped-native appears among priced holdings.
    const priced = topHoldings
      .filter(h => prices[h.contract?.toLowerCase()])
      .map(h => ({
        contract: h.contract,
        symbol: h.symbol || prices[h.contract.toLowerCase()]?.symbol,
        amount: h.amount,
        priceUsd: prices[h.contract.toLowerCase()].price,
        valueUsd: h.amount * prices[h.contract.toLowerCase()].price
      }))
      .sort((a, b) => b.valueUsd - a.valueUsd);

    const tokensValueUsd = priced.reduce((sum, p) => sum + p.valueUsd, 0);

    return {
      statusCode: 200,
      headers: NO_CACHE_HEADERS,
      body: JSON.stringify({
        address,
        chain,
        nativeBalance,
        tokensValueUsd,
        topHoldings: priced.slice(0, 8),
        approximate: chain === 'ethereum', // flag the honest limitation to the frontend
        fetchedAt: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error('EVM portfolio fetch failed:', err.message);
    return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
