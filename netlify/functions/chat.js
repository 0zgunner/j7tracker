const fetch = require('node-fetch');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
// llama-3.3-70b-versatile was deprecated by Groq on June 17, 2026.
// openai/gpt-oss-120b is Groq's recommended replacement - stronger reasoning too.
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM_PROMPT = `You are the assistant inside J7Tracker, a crypto wallet and token-risk monitoring dashboard. You can answer general crypto questions (how things work, what red flags mean, market concepts) and you can also answer questions about the user's own tracked data when it's provided to you below.

Rules:
- Never give direct financial advice ("buy this", "sell this now"). Explain risk factors and let the user decide.
- If the user's tracked data is provided, ground your answer in it and reference specifics (token addresses, risk levels, wallet activity, timestamps). Do the actual comparison/reasoning yourself rather than just restating the raw data back.
- If no relevant tracked data is available for a question, say so plainly and answer from general knowledge instead.
- The conversation history you're given may span multiple past sessions, not just this one — use it for continuity (e.g. if the user previously discussed a specific token or wallet, you can refer back to it).
- Keep answers concise and conversational, not essay-length, unless the user asks for depth. Prioritize being specific and directly useful over being exhaustive.
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

  const contextSummary = context ? `Here is the user's current tracked data in J7Tracker:\n${JSON.stringify(context).slice(0, 6000)}` : 'No tracked data was provided for this question.';

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
