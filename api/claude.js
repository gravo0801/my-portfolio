
// Vercel API Route: /api/claude
// Claude API 프록시 (CORS 우회 + API 키 서버사이드 처리)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
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
    res.status(502).json({ error: e.message });
  }
}
