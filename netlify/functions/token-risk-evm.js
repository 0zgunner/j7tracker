const fetch = require('node-fetch');

const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache'
};

const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY;
const HONEYPOT_API_KEY = process.env.HONEYPOT_API_KEY; // optional

const CHAIN_CONFIG = {
  ethereum: {
    explorerUrl: 'https://api.etherscan.io/api',
    apiKeyParam: () => `&apikey=${ETHERSCAN_KEY}`,
    supportsHolders: false // Etherscan's free tier doesn't expose a holder list
  },
  robinhood: {
    explorerUrl: 'https://robinhoodchain.blockscout.com/api',
    apiKeyParam: () => '', // Blockscout's compatible API needs no key
    supportsHolders: true,
    holdersV2Url: (addr) => `https://robinhoodchain.blockscout.com/api/v2/tokens/${addr}/holders`
  }
};

async function getSourceVerified(chain, address) {
  const cfg = CHAIN_CONFIG[chain];
  try {
    const url = `${cfg.explorerUrl}?module=contract&action=getsourcecode&address=${address}${cfg.apiKeyParam()}`;
    const res = await fetch(url);
    const data = await res.json();
    const entry = data?.result?.[0];
    return {
      verified: !!(entry && entry.SourceCode && entry.SourceCode.length > 0),
      contractName: entry?.ContractName || null
    };
  } catch (err) {
    console.error('Source verification check failed:', err.message);
    return { verified: null, contractName: null };
  }
}

// Calls the standard Ownable owner() function (selector 0x8da5cb5b) via
// eth_call. Many tokens don't implement this at all - that's not itself
// a red flag, just means this particular check doesn't apply.
async function getOwnerAddress(chain, address) {
  const cfg = CHAIN_CONFIG[chain];
  try {
    const url = `${cfg.explorerUrl}?module=proxy&action=eth_call&to=${address}&data=0x8da5cb5b&tag=latest${cfg.apiKeyParam()}`;
    const res = await fetch(url);
    const data = await res.json();
    const result = data?.result;
    if (!result || result === '0x' || result.length < 66) return { supported: false, owner: null };
    const ownerHex = '0x' + result.slice(-40);
    return { supported: true, owner: ownerHex };
  } catch (err) {
    console.error('Owner check failed:', err.message);
    return { supported: false, owner: null };
  }
}

async function getHolderConcentration(chain, address) {
  const cfg = CHAIN_CONFIG[chain];
  if (!cfg.supportsHolders) return { available: false };
  try {
    const res = await fetch(cfg.holdersV2Url(address));
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) return { available: false };

    const totalSupply = items.reduce((sum, h) => sum + parseFloat(h.value || 0), 0);
    const top10 = items.slice(0, 10).reduce((sum, h) => sum + parseFloat(h.value || 0), 0);
    const concentrationPct = totalSupply > 0 ? (top10 / totalSupply) * 100 : 0;
    return { available: true, concentrationPct, holderCount: items.length };
  } catch (err) {
    console.error('Holder concentration check failed:', err.message);
    return { available: false };
  }
}

async function getMarketData(address) {
  // DexScreener's token endpoint searches globally by address across all
  // chains it indexes, so this is shared logic regardless of EVM chain.
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    const data = await res.json();
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];
    if (pairs.length === 0) return null;
    const primary = pairs.reduce((best, p) =>
      (p.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? p : best, pairs[0]);
    return {
      liquidityUsd: primary.liquidity?.usd || 0,
      volume24h: primary.volume?.h24 || 0,
      buys24h: primary.txns?.h24?.buys || 0,
      sells24h: primary.txns?.h24?.sells || 0,
      priceUsd: primary.priceUsd,
      marketCap: primary.marketCap || primary.fdv || null,
      dexId: primary.dexId,
      pairAddress: primary.pairAddress,
      chainId: primary.chainId
    };
  } catch (err) {
    console.error('DexScreener fetch failed:', err.message);
    return null;
  }
}

// GoPlus is free and keyless - the default security layer. Only supports
// well-established chains (chain_id 1 = Ethereum); Robinhood Chain is too
// new to be in their supported list, so this gracefully returns
// unavailable there rather than erroring.
const GOPLUS_CHAIN_IDS = { ethereum: '1' };

async function checkGoPlus(chain, address) {
  const chainId = GOPLUS_CHAIN_IDS[chain];
  if (!chainId) return { available: false };
  try {
    const res = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`);
    const data = await res.json();
    const info = data?.result?.[address.toLowerCase()];
    if (!info) return { available: false };
    return {
      available: true,
      isHoneypot: info.is_honeypot === '1',
      isMintable: info.is_mintable === '1',
      isOpenSource: info.is_open_source === '1',
      ownerAddress: info.owner_address,
      canTakeBackOwnership: info.can_take_back_ownership === '1',
      hiddenOwner: info.hidden_owner === '1',
      buyTax: info.buy_tax,
      sellTax: info.sell_tax,
      lpHolderCount: info.lp_holder_count,
      holderCount: info.holder_count
    };
  } catch (err) {
    console.error('GoPlus check failed:', err.message);
    return { available: false };
  }
}

async function checkHoneypot(address) {
  if (!HONEYPOT_API_KEY) return { checked: false };
  try {
    const res = await fetch(`https://api.honeypot.is/v2/IsHoneypot?address=${address}`, {
      headers: { 'X-API-KEY': HONEYPOT_API_KEY }
    });
    const data = await res.json();
    return {
      checked: true,
      isHoneypot: data?.honeypotResult?.isHoneypot,
      buyTax: data?.simulationResult?.buyTax,
      sellTax: data?.simulationResult?.sellTax
    };
  } catch (err) {
    console.error('Honeypot check failed:', err.message);
    return { checked: false };
  }
}

function computeRisk(chain, verified, ownerInfo, holders, market, honeypot, goplus) {
  const flags = [];
  let riskPoints = 0;

  if (verified.verified === true) {
    flags.push({ severity: 'ok', label: `Contract source code is verified${verified.contractName ? ` (${verified.contractName})` : ''}` });
  } else if (verified.verified === false) {
    flags.push({ severity: 'high', label: 'Contract source code is NOT verified — cannot be audited before interacting with it' });
    riskPoints += 35;
  } else {
    flags.push({ severity: 'medium', label: 'Could not determine contract verification status' });
    riskPoints += 10;
  }

  if (ownerInfo.supported) {
    const isZeroAddress = ownerInfo.owner === '0x0000000000000000000000000000000000000000';
    if (isZeroAddress) {
      flags.push({ severity: 'ok', label: 'Ownership renounced (owner is the zero address) — deployer can no longer change contract behavior' });
    } else {
      flags.push({ severity: 'medium', label: `Ownership NOT renounced — deployer wallet (${ownerInfo.owner.slice(0, 6)}...${ownerInfo.owner.slice(-4)}) may still be able to change contract behavior` });
      riskPoints += 20;
    }
  } else {
    flags.push({ severity: 'ok', label: 'No standard owner() function found (not itself a red flag — many tokens don\'t use this pattern)' });
  }

  if (holders.available) {
    if (holders.concentrationPct > 70) {
      flags.push({ severity: 'high', label: `Top 10 holders control ${holders.concentrationPct.toFixed(1)}% of supply — high concentration` });
      riskPoints += 30;
    } else if (holders.concentrationPct > 40) {
      flags.push({ severity: 'medium', label: `Top 10 holders control ${holders.concentrationPct.toFixed(1)}% of supply` });
      riskPoints += 15;
    } else {
      flags.push({ severity: 'ok', label: `Top 10 holders control ${holders.concentrationPct.toFixed(1)}% of supply` });
    }
  } else {
    flags.push({ severity: 'medium', label: `Holder concentration data isn't available for free on ${chain === 'ethereum' ? 'Etherscan\'s free tier' : 'this chain'} — check manually` });
    riskPoints += 5;
  }

  if (goplus.available) {
    if (goplus.isHoneypot) {
      flags.push({ severity: 'high', label: 'GoPlus flags this as a honeypot — may not be sellable after buying' });
      riskPoints += 50;
    } else {
      flags.push({ severity: 'ok', label: 'GoPlus honeypot check: passed' });
    }
    if (goplus.isMintable) {
      flags.push({ severity: 'high', label: 'Contract has an active mint function — supply can be inflated at will' });
      riskPoints += 30;
    }
    if (goplus.hiddenOwner) {
      flags.push({ severity: 'high', label: 'GoPlus detected a hidden owner — contract can be controlled even if ownership looks renounced' });
      riskPoints += 30;
    }
    if (goplus.canTakeBackOwnership) {
      flags.push({ severity: 'high', label: 'Ownership can be reclaimed by the deployer despite appearing renounced' });
      riskPoints += 25;
    }
    const buyTax = parseFloat(goplus.buyTax || 0) * 100;
    const sellTax = parseFloat(goplus.sellTax || 0) * 100;
    if (sellTax > 15 || buyTax > 15) {
      flags.push({ severity: 'medium', label: `GoPlus reports buy tax ${buyTax.toFixed(1)}% / sell tax ${sellTax.toFixed(1)}% — high transfer taxes` });
      riskPoints += 15;
    } else if (buyTax > 0 || sellTax > 0) {
      flags.push({ severity: 'ok', label: `GoPlus reports buy tax ${buyTax.toFixed(1)}% / sell tax ${sellTax.toFixed(1)}%` });
    }
    if (!goplus.isOpenSource) {
      flags.push({ severity: 'medium', label: 'GoPlus reports contract source is not open/verified' });
      riskPoints += 10;
    }
  } else if (chain === 'ethereum') {
    flags.push({ severity: 'medium', label: 'GoPlus security data unavailable for this token — checked independently via other methods below' });
  }

  if (honeypot.checked) {
    if (honeypot.isHoneypot) {
      flags.push({ severity: 'high', label: 'Honeypot check FAILED — this token may not be sellable after buying' });
      riskPoints += 50;
    } else {
      const buyTax = parseFloat(honeypot.buyTax || 0);
      const sellTax = parseFloat(honeypot.sellTax || 0);
      flags.push({ severity: 'ok', label: `Honeypot check passed (buy tax ${buyTax}%, sell tax ${sellTax}%)` });
      if (sellTax > 15) {
        flags.push({ severity: 'medium', label: `Sell tax is unusually high (${sellTax}%)` });
        riskPoints += 15;
      }
    }
  } else if (goplus.available) {
    // GoPlus already covered honeypot detection above - no penalty for
    // skipping the optional honeypot.is layer.
  } else {
    flags.push({ severity: 'medium', label: 'No honeypot data available from either GoPlus or honeypot.is for this token' });
    riskPoints += 10;
  }

  if (!market) {
    flags.push({ severity: 'medium', label: 'No DEX pair found — token may not be trading yet or has no liquidity' });
    riskPoints += 15;
  } else {
    if (market.liquidityUsd < 1000) {
      flags.push({ severity: 'high', label: `Very thin liquidity ($${market.liquidityUsd.toFixed(0)})` });
      riskPoints += 25;
    } else if (market.liquidityUsd < 10000) {
      flags.push({ severity: 'medium', label: `Low liquidity ($${market.liquidityUsd.toFixed(0)})` });
      riskPoints += 10;
    } else {
      flags.push({ severity: 'ok', label: `Liquidity: $${market.liquidityUsd.toLocaleString()}` });
    }
    flags.push({ severity: 'ok', label: `24h volume: $${(market.volume24h || 0).toLocaleString()}` });
  }

  let level = 'low';
  if (riskPoints >= 45) level = 'high';
  else if (riskPoints >= 15) level = 'medium';

  return { level, score: riskPoints, flags, market };
}

exports.handler = async (event) => {
  const address = event.queryStringParameters?.address;
  const chain = event.queryStringParameters?.chain;

  if (!address || !chain || !CHAIN_CONFIG[chain]) {
    return { statusCode: 400, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Missing or invalid "address"/"chain" parameter (chain must be ethereum or robinhood)' }) };
  }
  if (chain === 'ethereum' && !ETHERSCAN_KEY) {
    return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'ETHERSCAN_API_KEY not configured' }) };
  }

  try {
    const [verified, ownerInfo, holders, market, honeypot, goplus] = await Promise.all([
      getSourceVerified(chain, address),
      getOwnerAddress(chain, address),
      getHolderConcentration(chain, address),
      getMarketData(address),
      chain === 'ethereum' ? checkHoneypot(address) : Promise.resolve({ checked: false }),
      checkGoPlus(chain, address)
    ]);

    const risk = computeRisk(chain, verified, ownerInfo, holders, market, honeypot, goplus);

    return {
      statusCode: 200,
      headers: NO_CACHE_HEADERS,
      body: JSON.stringify({
        address,
        chain,
        ...risk,
        checkedAt: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error('EVM token risk check failed:', err.message);
    return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: err.message, address }) };
  }
};
