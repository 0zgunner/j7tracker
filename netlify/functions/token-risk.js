const fetch = require('node-fetch');

const HELIUS_KEY = process.env.HELIUS_API_KEY;
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// Prevents browsers/CDNs from silently serving a stale cached response for
// repeat scans of the same token mint (same URL each time = cache risk).
const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache'
};

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
  const result = await rpcCall('getAccountInfo', [mintAddress, { encoding: 'jsonParsed' }]);
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

// Heuristic bundled-wallet check: fetch the controlling wallet behind each of
// the next several top holders (excluding the largest, already checked above)
// and count how many look like freshly created / low-activity wallets. A
// cluster of near-empty-history wallets each holding a meaningful chunk of
// supply is a common signature of a deployer "bundling" a launch across many
// wallets to dodge concentration checks, then dumping them together.
async function checkBundledWallets(topHolders) {
  const candidates = topHolders.slice(1, 6); // holders #2-#6
  if (candidates.length === 0) return { freshCount: 0, checked: 0 };

  let freshCount = 0;
  let checked = 0;

  for (const holder of candidates) {
    try {
      const accInfo = await rpcCall('getAccountInfo', [holder.address, { encoding: 'jsonParsed' }]);
      const controllingWallet = accInfo?.value?.data?.parsed?.info?.owner;
      if (!controllingWallet) continue;

      const sigs = await rpcCall('getSignaturesForAddress', [controllingWallet, { limit: 5 }]);
      checked++;
      // A wallet with only a handful of total signatures ever is very likely
      // a fresh, purpose-made wallet rather than an established trader.
      if (Array.isArray(sigs) && sigs.length <= 3) {
        freshCount++;
      }
    } catch (err) {
      console.error('Bundled wallet check failed for a holder:', err.message);
    }
  }

  return { freshCount, checked };
}

async function getMarketData(mintAddress) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`);
    const data = await res.json();
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];
    if (pairs.length === 0) return null;
    const primary = pairs.reduce((best, p) =>
      (p.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? p : best, pairs[0]);
    const dexId = primary.dexId || '';
    const marketCap = primary.marketCap || primary.fdv || null;
    // Pump.fun graduates a token to Raydium once its market cap hits
    // roughly $69,000 (~85 SOL). This is a market-cap-based approximation
    // of bonding curve progress, not a read of the exact on-chain curve
    // reserve numbers, but it's a close and useful proxy while a token is
    // still pre-migration.
    let bondingCurveProgress = null;
    if (dexId.toLowerCase().includes('pump') && marketCap) {
      bondingCurveProgress = Math.min(100, (marketCap / 69000) * 100);
    }
    return {
      liquidityUsd: primary.liquidity?.usd || 0,
      volume24h: primary.volume?.h24 || 0,
      buys24h: primary.txns?.h24?.buys || 0,
      sells24h: primary.txns?.h24?.sells || 0,
      priceUsd: primary.priceUsd,
      marketCap,
      bondingCurveProgress,
      dexId: primary.dexId,
      pairAddress: primary.pairAddress,
      chainId: primary.chainId,
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

// Known Solana burn/incinerator address used by common burn tools.
const KNOWN_BURN_ADDRESSES = new Set([
  '1nc1nerator11111111111111111111111111111'
]);

// Checks whether the pool's LP tokens are burned, locked in a program, or
// sitting in a plain wallet (the real rug-pull lever: whoever holds the LP
// tokens can pull the liquidity at any time unless it's burned or locked).
// Only meaningful once a token has migrated off Pump.fun's bonding curve
// onto an AMM like Raydium - pre-migration, liquidity lives in the bonding
// curve program itself and can't be pulled directly.
async function checkLiquidityLock(market) {
  if (!market) return { status: 'unknown', detail: 'No DEX pair found to check.' };

  const dexId = (market.dexId || '').toLowerCase();
  if (dexId.includes('pump')) {
    return {
      status: 'locked_by_design',
      detail: 'Still on Pump.fun bonding curve — liquidity is held by the program itself and can\'t be pulled by the deployer pre-migration.'
    };
  }

  if (!dexId.includes('raydium') || !market.pairAddress) {
    return { status: 'unknown', detail: `Liquidity lock status can't be verified for this venue (${market.dexId || 'unknown'}) — check manually.` };
  }

  try {
    const poolRes = await fetch(`https://api-v3.raydium.io/pools/info/ids?ids=${market.pairAddress}`);
    const poolData = await poolRes.json();
    const pool = poolData?.data?.[0];
    const lpMint = pool?.lpMint?.address || pool?.lpMint;
    if (!lpMint) {
      return { status: 'unknown', detail: 'Could not find the LP mint for this pool — check manually.' };
    }

    const lpHolders = await rpcCall('getTokenLargestAccounts', [lpMint]);
    const topLp = lpHolders?.value?.[0];
    if (!topLp) {
      return { status: 'unknown', detail: 'LP token has no holders found — check manually.' };
    }

    const lpAccInfo = await rpcCall('getAccountInfo', [topLp.address, { encoding: 'jsonParsed' }]);
    const lpOwnerWallet = lpAccInfo?.value?.data?.parsed?.info?.owner;

    if (lpOwnerWallet && KNOWN_BURN_ADDRESSES.has(lpOwnerWallet)) {
      return { status: 'burned', detail: 'Largest LP holder is a known burn address — liquidity appears burned and can\'t be withdrawn.' };
    }

    if (lpOwnerWallet) {
      const walletInfo = await rpcCall('getAccountInfo', [lpOwnerWallet, { encoding: 'base64' }]);
      const ownerProgram = walletInfo?.value?.owner;
      const isProgramControlled = ownerProgram && ownerProgram !== '11111111111111111111111111111111';
      if (isProgramControlled) {
        return { status: 'possibly_locked', detail: 'Largest LP holder is a program-controlled address (possibly a locker service) — verify manually which one.' };
      }
      return { status: 'unlocked', detail: 'Largest LP holder is a regular wallet — liquidity does not appear burned or locked, and could be withdrawn at any time.' };
    }

    return { status: 'unknown', detail: 'Could not determine who controls the LP tokens — check manually.' };
  } catch (err) {
    console.error('Liquidity lock check failed:', err.message);
    return { status: 'unknown', detail: 'Liquidity lock check failed — check manually.' };
  }
}

function computeRisk(parsed, owner, topHolders, market, topHolderType, bundleCheck, liquidityLock) {
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
    flags.push({ severity: 'high', label: 'Mint authority is still active — deployer can create unlimited new tokens' });
    riskPoints += 40;
  } else {
    flags.push({ severity: 'ok', label: 'Mint authority revoked — supply is fixed' });
  }

  if (freezeAuthorityActive) {
    flags.push({ severity: 'high', label: 'Freeze authority is still active — deployer can block holders from selling' });
    riskPoints += 30;
  } else {
    flags.push({ severity: 'ok', label: 'Freeze authority revoked' });
  }

  const totalSupply = topHolders.reduce((sum, h) => sum + parseFloat(h.uiAmountString || h.uiAmount || 0), 0);
  const top10Supply = topHolders.slice(0, 10).reduce((sum, h) => sum + parseFloat(h.uiAmountString || h.uiAmount || 0), 0);
  const concentrationPct = totalSupply > 0 ? (top10Supply / totalSupply) * 100 : 0;

  if (topHolderType?.isLikelyPool) {
    flags.push({ severity: 'ok', label: 'Largest holder address looks program-controlled (likely the liquidity pool, not a private wallet)' });
  } else if (topHolderType?.controllingWallet) {
    flags.push({ severity: 'medium', label: 'Largest holder appears to be a regular wallet, not a pool — worth checking manually who controls it' });
    riskPoints += 10;
  }

  // Tightened thresholds: 30%+ now flags as medium risk on its own.
  if (concentrationPct > 90) {
    flags.push({ severity: 'high', label: `Top 10 holders control ${concentrationPct.toFixed(1)}% of visible supply — extremely concentrated` });
    riskPoints += 45;
  } else if (concentrationPct > 70) {
    flags.push({ severity: 'high', label: `Top 10 holders control ${concentrationPct.toFixed(1)}% of visible supply — high concentration` });
    riskPoints += 35;
  } else if (concentrationPct > 50) {
    flags.push({ severity: 'medium', label: `Top 10 holders control ${concentrationPct.toFixed(1)}% of visible supply — elevated concentration` });
    riskPoints += 25;
  } else if (concentrationPct > 30) {
    flags.push({ severity: 'medium', label: `Top 10 holders control ${concentrationPct.toFixed(1)}% of visible supply` });
    riskPoints += 15;
  } else {
    flags.push({ severity: 'ok', label: `Top 10 holders control ${concentrationPct.toFixed(1)}% of visible supply` });
  }

  // Bundled wallet heuristic
  if (bundleCheck && bundleCheck.checked > 0) {
    if (bundleCheck.freshCount >= 3) {
      flags.push({
        severity: 'high',
        label: `${bundleCheck.freshCount} of the next largest holders look like freshly created wallets with almost no history — possible bundled/sniper buying at launch`
      });
      riskPoints += 30;
    } else if (bundleCheck.freshCount >= 1) {
      flags.push({
        severity: 'medium',
        label: `${bundleCheck.freshCount} of the next largest holders look like fresh wallets — worth a manual check`
      });
      riskPoints += 10;
    } else {
      flags.push({ severity: 'ok', label: 'No obvious cluster of fresh/bundled wallets among top holders' });
    }
  }

  if (market?.bondingCurveProgress !== null && market?.bondingCurveProgress !== undefined) {
    const pct = market.bondingCurveProgress;
    flags.push({
      severity: 'ok',
      label: `Bonding curve progress: ${pct.toFixed(1)}% toward Pump.fun graduation (~$69k market cap)`
    });
  }

  if (liquidityLock) {
    if (liquidityLock.status === 'unlocked') {
      flags.push({ severity: 'high', label: liquidityLock.detail });
      riskPoints += 35;
    } else if (liquidityLock.status === 'possibly_locked') {
      flags.push({ severity: 'medium', label: liquidityLock.detail });
      riskPoints += 10;
    } else if (liquidityLock.status === 'burned' || liquidityLock.status === 'locked_by_design') {
      flags.push({ severity: 'ok', label: liquidityLock.detail });
    } else {
      flags.push({ severity: 'medium', label: liquidityLock.detail });
      riskPoints += 5;
    }
  }

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
    return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'HELIUS_API_KEY not configured' }) };
  }

  const mint = event.queryStringParameters?.mint;
  if (!mint) {
    return { statusCode: 400, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Missing required "mint" parameter' }) };
  }

  try {
    const [{ parsed, owner }, topHolders, market] = await Promise.all([
      getMintAccount(mint),
      getTopHolders(mint),
      getMarketData(mint)
    ]);

    const [topHolderType, bundleCheck, liquidityLock] = await Promise.all([
      topHolders.length > 0 ? checkTopHolderType(topHolders[0].address) : null,
      checkBundledWallets(topHolders),
      checkLiquidityLock(market)
    ]);

    const risk = computeRisk(parsed, owner, topHolders, market, topHolderType, bundleCheck, liquidityLock);

    return {
      statusCode: 200,
      headers: NO_CACHE_HEADERS,
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
    return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: err.message, mint }) };
  }
};
