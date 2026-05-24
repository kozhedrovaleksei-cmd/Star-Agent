export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, ticker, prompt, tavilyKey } = req.body;
  const crKey = process.env.CRAZYROUTER_KEY;
  const tvKey = tavilyKey || process.env.TAVILY_KEY;

  try {
    // ACTION: get Yahoo Finance price
    if (action === 'price') {
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const data = await r.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta) return res.json({ price: null });
      return res.json({
        price: meta.regularMarketPrice,
        prev: meta.chartPreviousClose,
        high52: meta.fiftyTwoWeekHigh,
        low52: meta.fiftyTwoWeekLow,
        marketCap: meta.marketCap
      });
    }

    // ACTION: Tavily search
    if (action === 'search') {
      if (!tvKey) return res.json({ result: '' });
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tvKey,
          query: req.body.query,
          search_depth: 'basic',
          max_results: 5,
          include_answer: true
        })
      });
      const data = await r.json();
      const result = data.answer || (data.results || []).map(x => x.title + ': ' + x.content).join('\n\n');
      return res.json({ result });
    }

    // ACTION: Claude analyze
    if (action === 'analyze') {
      if (!crKey) return res.status(500).json({ error: 'No API key' });
      const r = await fetch('https://crazyrouter.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${crKey}`,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const data = await r.json();
      if (data.error) return res.status(500).json({ error: data.error.message });
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      return res.json({ text });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
