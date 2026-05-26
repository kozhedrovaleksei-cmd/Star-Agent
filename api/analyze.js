export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, ticker, prompt, query, url } = req.body;
  const crKey = process.env.CRAZYROUTER_KEY;
  const tvKey = process.env.TAVILY_KEY;
  const fcKey = process.env.FIRECRAWL_KEY;

  try {

    // ─── Yahoo Finance price ───────────────────────────────────────────────
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

    // ─── Tavily search ─────────────────────────────────────────────────────
    if (action === 'search') {
      if (!tvKey) return res.json({ result: '' });
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tvKey,
          query: query || '',
          search_depth: 'basic',
          max_results: 5,
          include_answer: true
        })
      });
      const data = await r.json();
      const result = data.answer || (data.results || []).map(x => x.title + ': ' + x.content).join('\n\n');
      return res.json({ result });
    }

    // ─── Firecrawl scrape ──────────────────────────────────────────────────
    if (action === 'scrape') {
      if (!fcKey) return res.json({ result: 'Firecrawl key not set' });
      if (!url) return res.json({ result: 'No URL provided' });

      const r = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${fcKey}`
        },
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          onlyMainContent: true,
          waitFor: 2000
        })
      });
      const data = await r.json();
      const result = data?.data?.markdown || data?.markdown || 'Не удалось получить данные';
      // Обрезаем до 3000 символов чтобы не переполнить контекст
      return res.json({ result: result.slice(0, 3000) });
    }

    // ─── Firecrawl + Claude: инсайдеры по тикеру ──────────────────────────
    if (action === 'insiders') {
      if (!fcKey || !crKey) return res.json({ result: '' });

      // Парсим OpenInsider напрямую
      const insiderUrl = `https://openinsider.com/search?q=${ticker}`;
      const r = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${fcKey}`
        },
        body: JSON.stringify({
          url: insiderUrl,
          formats: ['markdown'],
          onlyMainContent: true,
          waitFor: 2000
        })
      });
      const data = await r.json();
      const raw = data?.data?.markdown || data?.markdown || '';
      return res.json({ result: raw.slice(0, 2000) });
    }

    // ─── Claude analyze WITH web_search ───────────────────────────────────
    if (action === 'analyze') {
      if (!crKey) return res.status(500).json({ error: 'No API key' });

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
          max_tokens: 8000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const d1 = await r1.json();
      const hasToolUse = (d1.content || []).some(b => b.type === 'tool_use');

      if (hasToolUse) {
        const toolResults = (d1.content || [])
          .filter(b => b.type === 'tool_use')
          .map(b => ({
            type: 'tool_result',
            tool_use_id: b.id,
            content: b.input ? JSON.stringify(b.input) : 'search executed'
          }));

        const r2 = await fetch('https://crazyrouter.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${crKey}`,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'web-search-2025-03-05'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
            max_tokens: 8000,
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
            messages: [
              { role: 'user', content: prompt },
              { role: 'assistant', content: d1.content },
              { role: 'user', content: toolResults }
            ]
          })
        });

        const d2 = await r2.json();
        if (d2.error) return res.status(500).json({ error: d2.error.message });
        const text = (d2.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
        return res.json({ text });
      }

      if (d1.error) return res.status(500).json({ error: d1.error.message });
      const text = (d1.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      return res.json({ text });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
