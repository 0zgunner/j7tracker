const fetch = require('node-fetch');

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// Token-2022 extensions that can act as a functional backdoor
const DANGEROUS_EXTENSIONS = {
  permanentDelegate: 'Permanent Delegate — a hidden address can move or burn ANY holder\'s tokens without permission',
  transferHook: 'Transfer Hook — custom code runs on every transfer, can be used to block selling',
  transferFeeConfig: 'Transfer Fee — deployer can charge a fee on every transfer, including a maximum that can trap value',
  defaultAccountState: 'Default Account State — new holder accounts can be frozen by default'
};

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

async function getMintAccount(mintAddress) {
  const result = await rpcCall('getAccountInfo', [
    mintAddress,
    { encoding: 'jsonParsed' }
  ]);
  const value = result?.value;
  const parsed = value?.data?.parsed?.info;
  if (!parsed) throw new Error('Mint account not found or not a token mint');
  return { parsed, owner: value.owner };
}

async function getTopHolders(mintAddress) {
  const result = await rpcCall('getTokenLargestAccounts', [mintAddress]);
  return result?.value || [];
}

async function checkTopHolderType(topHolderTokenAccount) {
  try {
    // The token account address holds the tokens; its "owner" field is the
    // wallet/authority that controls it. Look that wallet up in turn: a
    // normal user wallet is owned by the System Program, while a pool
    // authority is typically a PDA owned by the DEX's own program.
    const accInfo = await rpcCall('getAccountInfo', [topHolderTokenAccount, { encoding: 'jsonParsed' }]);
    const controllingWallet = accInfo?.value?.data?.parsed?.info?.owner;
    if (!controllingWallet) return { isLikelyPool: false, controllingWallet: null };

    const walletInfo = await rpcCall('getAccountInfo', [controllingWallet, { encoding: 'base64' }]);
    const walletOwnerProgram = walletInfo?.value?.owner;
    const isLikelyPool = walletOwnerProgram && walletOwnerProgram !== '11111111111111111111111111111111';
    return { isLikelyPool, controllingWallet };
  } catch (err) {
    console.error('Top holder type check failed:', err.message);
    return { isLikelyPool: false, controllingWallet: null };
  }
}

async function getMarketData(mintAddress) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`);
    const data = await res.json();
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];
    if (pairs.length === 0) return null;
    // Use the pair with the highest liquidity as the primary reference
    const primary = pairs.reduce((best, p) =>
      (p.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? p : best, pairs[0]);
    return {
      liquidityUsd: primary.liquidity?.usd || 0,
      volume24h: primary.volume?.h24 || 0,
      buys24h: primary.txns?.h24?.buys || 0,
      sells24h: primary.txns?.h24?.sells || 0,
      priceUsd: primary.priceUsd,
      dexId: primary.dexId,
      pairCount: pairs.length
    };
  } catch (err) {
    console.error('DexScreener fetch failed:', err.message);
    return null;
  }
}

function checkExtensions(parsed) {
  const flags = [];
  let points = 0;
  const extensions = parsed.extensions || [];

  extensions.forEach(ext => {
    const key = ext.extension;
    if (DANGEROUS_EXTENSIONS[key]) {
      flags.push({ severity: 'high', label: DANGEROUS_EXTENSIONS[key] });
      points += 25;
    }
  });

  return { flags, points };
}

function computeRisk(parsed, owner, topHolders, market, topHolderType) {
  const flags = [];
  let riskPoints = 0;

  const isToken2022 = owner === TOKEN_2022_PROGRAM_ID;
  flags.push({
    severity: 'ok',
    label: isToken2022 ? 'Uses Token-2022 program (checking extensions)' : 'Uses standard SPL Token program'
  });

  if (isToken2022) {
    const extResult = checkExtensions(parsed);
    flags.push(...extResult.flags);
    riskPoints += extResult.points;
    if (extResult.flags.length === 0) {
      flags.push({ severity: 'ok', label: 'No dangerous Token-2022 extensions detected' });
    }
  }

  const mintAuthorityActive = !!parsed.mintAuthority;
  const freezeAuthorityActive = !!parsed.freezeAuthority;

  if (mintAuthorityActive) {
    flags.push({
      severity: 'high',
      label: 'Mint authority is still active — deployer can create unlimited new tokens'
    });
    riskPoints += 40;
  } else {
    flags.push({ severity: 'ok', label: 'Mint authority revoked — supply is fixed' });
  }

  if (freezeAuthorityActive) {
    flags.push({
      severity: 'high',
      label: 'Freeze authority is still active — deployer can block holders from selling'
    });
    riskPoints += 30;
  } else {
    flags.push({ severity: 'ok', label: 'Freeze authority revoked' });
  }

  const totalSupply = topHolders.reduce((sum, h) => sum + parseFloat(h.uiAmountString || h.uiAmount || 0), 0);
  const top10Supply = topHolders.slice(0, 10).reduce((sum, h) => sum + parseFloat(h.uiAmountString || h.uiAmount || 0), 0);
  const concentrationPct = totalSupply > 0 ? (top10Supply / totalSupply) * 100 : 0;

  if (topHolderType?.isLikelyPool) {
    flags.push({
      severity: 'ok',
      label: 'Largest holder address looks program-controlled (likely the liquidity pool, not a private wallet)'
    });
  } else if (topHolderType?.controllingWallet) {
    flags.push({
      severity: 'medium',
      label: 'Largest holder appears to be a regular wallet, not a pool — worth checking manually who controls it'
    });
    riskPoints += 10;
  }

  if (concentrationPct > 90) {
    flags.push({ severity: 'high', label: `Top 10 holders control ${concentrationPct.toFixed(1)}% of visible supply — extremely concentrated` });
    riskPoints += 45;
  } else if (concentrationPct > 70) {
    flags.push({ severity: 'high', label: `Top 10 holders control ${concentrationPct.toFixed(1)}% of visible supply — high concentration` });
    riskPoints += 30;
  } else if (concentrationPct > 50) {
    flags.push({ severity: 'medium', label: `Top 10 holders control ${concentrationPct.toFixed(1)}% of visible supply` });
    riskPoints += 20;
  } else {
    flags.push({ severity: 'ok', label: `Top 10 holders control ${concentrationPct.toFixed(1)}% of visible supply` });
  }

  // Liquidity and volume checks
  if (!market) {
    flags.push({ severity: 'medium', label: 'No DEX pair found — token may not be trading yet or has no liquidity' });
    riskPoints += 15;
  } else {
    if (market.liquidityUsd < 1000) {
      flags.push({ severity: 'high', label: `Very thin liquidity ($${market.liquidityUsd.toFixed(0)}) — easy to manipulate or rug` });
      riskPoints += 25;
    } else if (market.liquidityUsd < 10000) {
      flags.push({ severity: 'medium', label: `Low liquidity ($${market.liquidityUsd.toFixed(0)})` });
      riskPoints += 10;
    } else {
      flags.push({ severity: 'ok', label: `Liquidity: $${market.liquidityUsd.toLocaleString()}` });
    }

    const volLiqRatio = market.liquidityUsd > 0 ? market.volume24h / market.liquidityUsd : 0;
    if (volLiqRatio > 20) {
      flags.push({ severity: 'medium', label: `24h volume is ${volLiqRatio.toFixed(1)}x liquidity — unusually high, check for wash trading` });
      riskPoints += 10;
    } else {
      flags.push({ severity: 'ok', label: `24h volume: $${market.volume24h.toLocaleString()}` });
    }

    const totalTxns = market.buys24h + market.sells24h;
    if (totalTxns > 20) {
      const buyRatio = market.buys24h / totalTxns;
      if (buyRatio > 0.85 || buyRatio < 0.15) {
        flags.push({ severity: 'medium', label: `Heavily skewed buy/sell ratio (${market.buys24h} buys / ${market.sells24h} sells)` });
        riskPoints += 10;
      } else {
        flags.push({ severity: 'ok', label: `Buy/sell activity: ${market.buys24h} buys / ${market.sells24h} sells (24h)` });
      }
    }
  }

  let level = 'low';
  if (riskPoints >= 45) level = 'high';
  else if (riskPoints >= 15) level = 'medium';

  return { level, score: riskPoints, flags, concentrationPct, market };
}

exports.handler = async (event) => {
  if (!HELIUS_KEY) {
    return {
      statusCode: 200,
      body: JSON.stringify({ error: 'HELIUS_API_KEY not configured' })
    };
  }

  const mint = event.queryStringParameters?.mint;
  if (!mint) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required "mint" parameter' })
    };
  }

  try {
    const [{ parsed, owner }, topHolders, market] = await Promise.all([
      getMintAccount(mint),
      getTopHolders(mint),
      getMarketData(mint)
    ]);

    const topHolderType = topHolders.length > 0
      ? await checkTopHolderType(topHolders[0].address)
      : null;

    const risk = computeRisk(parsed, owner, topHolders, market, topHolderType);

    return {
      statusCode: 200,
      body: JSON.stringify({
        mint,
        decimals: parsed.decimals,
        supply: parsed.supply,
        ...risk,
        checkedAt: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error('Token risk check failed:', err.message);
    return {
      statusCode: 200,
      body: JSON.stringify({ error: err.message, mint })
    };
  }
};
