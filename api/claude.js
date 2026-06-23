import { applyApiSecurity, verifyFirebaseIdToken } from './_security.js';

// Vercel API Route: /api/claude
// Claude API 프록시 (CORS 우회 + API 키 서버사이드 처리)

export default async function handler(req, res) {
  if (!applyApiSecurity(req, res, {
    methods:["POST", "OPTIONS"],
    rateLimit:{ key:"claude", windowMs:60_000, max:20 },
  })) return;

  try {
    await verifyFirebaseIdToken(req);
    const { messages, system, max_tokens = 1000 } = req.body;
    if (!messages?.length) {
      return res.status(400).json({ error: 'messages required' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens,
        ...(system ? { system } : {}),
        messages,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    res.status(200).json(data);

  } catch (e) {
    res.status(e.statusCode || 502).json({ error: e.message });
  }
}
