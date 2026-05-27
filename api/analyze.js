export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, ticker, prompt, query } = req.body;
  const crKey = process.env.CRAZYROUTER_KEY;
  const tvKey = process.env.TAVILY_KEY;

  try {
    // === PRICE ===
    if (action === 'price') {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
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

    // === SEARCH ===
    if (action === 'search') {
      if (!tvKey) return res.json({ result: 'No Tavily key' });
      // ... (оставляем как было)
    }

    // === ANALYZE — УЛУЧШЕННАЯ ВЕРСИЯ ===
    if (action === 'analyze') {
      if (!crKey) return res.status(500).json({ error: 'No Crazyrouter key' });

      const finalPrompt = prompt + `\n\nВАЖНО: Верни ТОЛЬКО чистый JSON без markdown, без объяснений. Используй плоские поля для anticipation.`;

      const r1 = await fetch('https://crazyrouter.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${crKey}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'web-search-2025-03-05'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 6000,
          temperature: 0.3,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: finalPrompt }]
        })
      });

      // ... (полная обработка tool_use + retry logic — могу дать полностью)

      // Добавь агрессивную очистку JSON
      let text = ...;
      text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      // Попытка исправить распространённые ошибки Claude
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
