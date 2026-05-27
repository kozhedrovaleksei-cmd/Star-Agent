export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, ticker, prompt, query } = req.body;
  const crKey = process.env.CRAZYROUTER_KEY;
  const tvKey = process.env.TAVILY_KEY;

  async function callClaude(messages, maxTokens = 4000) {
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
        max_tokens: maxTokens,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages
      })
    });
    const d1 = await r1.json();
    if (d1.error) throw new Error(d1.error.message);

    const hasToolUse = (d1.content || []).some(b => b.type === 'tool_use');
    if (!hasToolUse) {
      const text = (d1.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      return text;
    }

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
        max_tokens: maxTokens,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [
          ...messages,
          { role: 'assistant', content: d1.content },
          { role: 'user', content: toolResults }
        ]
      })
    });
    const d2 = await r2.json();
    if (d2.error) throw new Error(d2.error.message);
    return (d2.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  }

  try {
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
      return res.json({
        result: data.answer || (data.results || []).map(x => x.title + ': ' + x.content).join('\n\n')
      });
    }

    if (action === 'analyze') {
      if (!crKey) return res.status(500).json({ error: 'No API key' });

      // ШАГ 1: Принудительный веб-поиск актуальных данных (май 2026)
      const searchPrompt = `Сейчас май 2026 года. Используй web_search tool ОБЯЗАТЕЛЬНО — без него не отвечай.

Выполни ЭТИ ЧЕТЫРЕ поиска прямо сейчас:
1. web_search("${ticker} stock price today May 2026")
2. web_search("${ticker} insider buying SEC Form 4 2026")  
3. web_search("${ticker} earnings news catalyst 2026")
4. web_search("${ticker} suppliers leading indicators correlation 2026")

После каждого поиска записывай результат. Затем выдай сводку:
- Текущая цена и изменение (из поиска 1)
- Market Cap, P/E, дивиденд, 52W High/Low (из поиска 1)
- Инсайдерские покупки CEO/CFO за последние 6 месяцев (из поиска 2)
- Ближайшие события и катализаторы (из поиска 3)
- Поставщики и опережающие индикаторы (из поиска 4)

ВАЖНО: Все данные должны быть из 2026 года. Данные старше января 2026 — не использовать.`;

      let rawData = '';
      try {
        rawData = await callClaude([{ role: 'user', content: searchPrompt }], 3000);
      } catch(e) {
        rawData = 'Веб-поиск недоступен, используй актуальные знания за 2026 год';
      }

      // ШАГ 2: Финальный анализ с реальными данными
      const analysisPrompt = `${prompt}

АКТУАЛЬНЫЕ ДАННЫЕ ИЗ ВЕБ-ПОИСКА (май 2026):
${rawData}

КРИТИЧНО: Используй данные выше как основу. Все цены, события и инсайдеры должны быть из 2026 года. Если в данных выше есть цена — используй её, не придумывай.`;

      const text = await callClaude([{ role: 'user', content: analysisPrompt }], 4000);
      return res.json({ text });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
