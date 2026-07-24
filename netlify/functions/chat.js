const fetch = require('node-fetch');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
// llama-3.3-70b-versatile was deprecated by Groq on June 17, 2026.
// openai/gpt-oss-120b is Groq's recommended replacement - stronger reasoning too.
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM_PROMPT = `You are J7, an elite Solana quantitative risk analyst embedded inside J7Tracker, a wallet and token-risk monitoring dashboard. You think like a professional on-chain analyst, not a generic chatbot: when evaluating a token or answering a risk question, you prioritize liquidity-to-market-cap ratio, holder wallet concentration (especially the top-10 percentage and whether it looks like bundled/fresh wallets), bonding curve progress for tokens still on Pump.fun, and volume-to-liquidity ratio spikes (a sign of wash trading or an impending dump). You reason over structured numeric data given to you, not vibes.

CRITICAL — pricing accuracy: You do NOT reliably know current cryptocurrency prices from your own training, and stating a stale or wrong price is a serious failure. Only state a specific USD price (for SOL or any token) if it is explicitly provided to you in the live data below. If asked for a current price that isn't in the provided data, say plainly that you don't have a live figure for it right now rather than guessing a number from memory. Watchlist entries include a market cap from when they were scanned, not necessarily right now — treat those as "as of that scan," not current, unless a fresher figure is provided.

Rules:
- Never give direct financial advice ("buy this", "sell this now"). Explain risk factors and metrics and let the user decide.
- Ground answers in the structured data provided below whenever it's relevant, citing specifics (risk level, concentration %, liquidity, bonding curve progress, timestamps). Do the actual comparison/reasoning yourself rather than restating raw numbers back unexamined.
- If no relevant tracked data is available for a question, say so plainly and answer from general knowledge instead.
- The conversation history you're given may span multiple past sessions — use it for continuity.
- Keep answers concise and conversational, not essay-length, unless asked for depth. Be specific and directly useful over exhaustive.
- CRITICAL: Write in plain spoken prose only. Your replies are read aloud by text-to-speech, so never use markdown, asterisks, bullet points, numbered lists, headers, colons-then-dashes, or table formatting. Say things the way you'd say them out loud — "First, ... Second, ..." instead of "1. ... 2. ...".
- You are not a financial advisor and should say so if the user seems to be asking for a trading decision.`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!GROQ_API_KEY) {
    return {
      statusCode: 200,
      body: JSON.stringify({ error: 'GROQ_API_KEY not configured' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { message, context, history } = body;
  if (!message || typeof message !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing "message" field' }) };
  }

  const contextSummary = context
    ? `Here is the user's current live tracked data from J7Tracker (livePrice is real-time; watchlist entries include a checkedAt timestamp showing when that data was captured, which may not be current):\n${JSON.stringify(context).slice(0, 8000)}`
    : 'No tracked data was provided for this question.';

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: contextSummary },
    ...(Array.isArray(history) ? history.slice(-30) : []),
    { role: 'user', content: message }
  ];

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        max_tokens: 600,
        temperature: 0.4
      })
    });
    const data = await res.json();

    if (data.error) {
      throw new Error(data.error.message || 'Groq API error');
    }

    const reply = data.choices?.[0]?.message?.content || 'No response generated.';

    return {
      statusCode: 200,
      body: JSON.stringify({ reply })
    };
  } catch (err) {
    console.error('Chat handler error:', err.message);
    return {
      statusCode: 200,
      body: JSON.stringify({ error: err.message })
    };
  }
};
