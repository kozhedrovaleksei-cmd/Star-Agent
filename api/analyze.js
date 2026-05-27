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
    // ==================== PRICE ====================
    if (action === 'price') {
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=5d`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const data = await r.json();
      const meta = data?.chart?.result?.[0]?.meta;
      
      if (!meta) return res.json({ price: null, error: 'No price data' });

      return res.json({
        price: meta.regularMarketPrice,
        prev: meta.chartPreviousClose,
        high52: meta.fiftyTwoWeekHigh,
        low52: meta.fiftyTwoWeekLow,
        marketCap: meta.marketCap,
        timestamp: Date.now()
      });
    }

    // ==================== SEARCH ====================
    if (action === 'search') {
      if (!tvKey) return res.json({ result: 'Tavily key not configured' });
      
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tvKey,
          query: query || '',
          search_depth: 'basic',
          max_results: 6,
          include_answer: true
        })
      });
      const data = await r.json();
      return res.json({ 
        result: data.answer || (data.results || []).map(x => `${x.title}: ${x.content}`).join('\n\n') 
      });
    }

    // ==================== ANALYZE (главный эндпоинт) ====================
    if (action === 'analyze') {
      if (!crKey) return res.status(500).json({ error: 'Crazyrouter key missing' });
      if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

      const enhancedPrompt = prompt + `

ВАЖНО:
- Отвечай ТОЛЬКО чистым JSON, без markdown, без объяснений.
- Используй строго плоские поля для anticipation (anticipationNarrative, anticipationInd1 и т.д.).
- Не используй вложенные объекты в anticipation.`;

      // Первый запрос
      let r1 = await fetch('https://crazyrouter.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${crKey}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'web-search-2025-03-05'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 6500,
          temperature: 0.25,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: enhancedPrompt }]
        })
      });

      let d1 = await r1.json();

      // Обработка tool use (web search)
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
            max_tokens: 6500,
            temperature: 0.25,
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
            messages: [
              { role: 'user', content: enhancedPrompt },
              { role: 'assistant', content: d1.content },
              { role: 'user', content: toolResults }
            ]
          })
        });

        const d2 = await r2.json();
        d1 = d2;
      }

      if (d1.error) {
        return res.status(500).json({ error: d1.error.message });
      }

      let text = (d1.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');

      // === АГРЕССИВНАЯ ОЧИСТКА ===
      text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      text = text.replace(/^[^{\[]+/, '');     // убираем текст до JSON
      text = text.replace(/[^}\]]+$/, '');     // убираем текст после JSON

      return res.json({ text });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (e) {
    console.error('STARK Agent Error:', e);
    return res.status(500).json({ 
      error: e.message,
      timestamp: Date.now()
    });
  }
}
