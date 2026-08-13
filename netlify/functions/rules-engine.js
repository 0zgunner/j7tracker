const fetch = require('node-fetch');

const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache'
};

const SITE_URL = process.env.URL || '';

// ---------------------------------------------------------------------
// This is the Stage 3 decision layer: it takes an existing risk scan
// (Stage 2 output, unchanged) and applies explicit, inspectable rules to
// produce one of three verdicts. It never trades, never touches a
// wallet, and never runs on its own - it only answers "would this pass
// my own thresholds" when asked. The rules are deliberately readable and
// editable here, not hidden inside a scoring black box, so you can see
// exactly why something was rejected or passed and adjust the
// thresholds yourself as you learn what you actually trust.
// ---------------------------------------------------------------------

const RULES = {
  minLiquidityUsd: 10000,
  maxConcentrationPct: 40,
  maxBondingCurveForEntry: 95, // avoid buying right at the graduation cliff
  rejectOnUnlockedLiquidity: true,
  rejectOnSerialDeployer: true,
  rejectOnSharedFunderBundle: true,
  reviewOnThirdPartyDisagreement: true
};

async function runScan(mint, chain) {
  const url = chain === 'solana'
    ? `${SITE_URL}/.netlify/functions/token-risk?mint=${mint}`
    : `${SITE_URL}/.netlify/functions/token-risk-evm?address=${mint}&chain=${chain}`;
  const res = await fetch(url);
  return res.json();
}

function evaluate(scan) {
  const reasons = { reject: [], review: [], pass: [] };
  const flags = scan.flags || [];

  const findFlag = (substr) => flags.find(f => f.label.toLowerCase().includes(substr.toLowerCase()));

  // --- Hard rejects: any one of these alone is disqualifying ---
  if (scan.level === 'high') {
    reasons.reject.push(`Overall scan risk level is HIGH (score ${scan.score})`);
  }

  const liqFlag = findFlag('largest lp holder is a regular wallet');
  if (RULES.rejectOnUnlockedLiquidity && liqFlag) {
    reasons.reject.push('Liquidity is not locked or burned - can be pulled at any time');
  }

  const sharedFunderFlag = findFlag('funded by the same source wallet');
  if (RULES.rejectOnSharedFunderBundle && sharedFunderFlag) {
    reasons.reject.push('Confirmed shared-funder wallet bundling among top holders');
  }

  const serialDeployerFlag = findFlag('serial-deployer pattern');
  if (RULES.rejectOnSerialDeployer && serialDeployerFlag) {
    reasons.reject.push('Deployer shows a serial-deployer pattern (created other tokens recently)');
  }

  const honeypotFlag = findFlag('may not be sellable') || findFlag('honeypot');
  if (honeypotFlag && honeypotFlag.severity === 'high') {
    reasons.reject.push('A honeypot/security scanner flagged this token as high risk');
  }

  const liquidityUsd = scan.market?.liquidityUsd ?? 0;
  if (liquidityUsd < RULES.minLiquidityUsd) {
    reasons.reject.push(`Liquidity ($${liquidityUsd.toLocaleString()}) is below the minimum threshold ($${RULES.minLiquidityUsd.toLocaleString()})`);
  }

  if (scan.concentrationPct && scan.concentrationPct > RULES.maxConcentrationPct) {
    reasons.reject.push(`Top-10 holder concentration (${scan.concentrationPct.toFixed(1)}%) exceeds the maximum threshold (${RULES.maxConcentrationPct}%)`);
  }

  // --- Soft flags: push to "review" rather than an automatic reject ---
  if (scan.level === 'medium') {
    reasons.review.push(`Overall scan risk level is MEDIUM (score ${scan.score}) - not disqualifying alone, worth a manual look`);
  }

  const bcProgress = scan.market?.bondingCurveProgress;
  if (bcProgress !== null && bcProgress !== undefined && bcProgress > RULES.maxBondingCurveForEntry) {
    reasons.review.push(`Bonding curve progress is ${bcProgress.toFixed(1)}% - very close to migration, volatility often spikes right before/after graduation`);
  }

  if (RULES.reviewOnThirdPartyDisagreement) {
    const rugcheckHigh = findFlag('rugcheck.xyz independently scored this high');
    if (rugcheckHigh && scan.level !== 'high') {
      reasons.review.push('RugCheck.xyz scored this higher risk than our own scan did - worth reconciling before trusting either alone');
    }
  }

  if (reasons.reject.length === 0 && reasons.review.length === 0) {
    reasons.pass.push('No configured rule thresholds were triggered');
  }

  let verdict = 'pass';
  if (reasons.reject.length > 0) verdict = 'reject';
  else if (reasons.review.length > 0) verdict = 'review';

  return { verdict, reasons, rulesApplied: RULES };
}

exports.handler = async (event) => {
  const mint = event.queryStringParameters?.mint || event.queryStringParameters?.address;
  const chain = event.queryStringParameters?.chain || 'solana';
  if (!mint) {
    return { statusCode: 400, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: 'Missing required "mint" or "address" parameter' }) };
  }

  try {
    const scan = await runScan(mint, chain);
    if (scan.error) {
      return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: scan.error }) };
    }
    const decision = evaluate(scan);
    return {
      statusCode: 200,
      headers: NO_CACHE_HEADERS,
      body: JSON.stringify({
        mint,
        chain,
        ...decision,
        scanLevel: scan.level,
        scanScore: scan.score,
        evaluatedAt: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error('Rules engine failed:', err.message);
    return { statusCode: 200, headers: NO_CACHE_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
