export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, ticker, prompt, query } = req.body;
  const crKey = process.env.CRAZYROUTER_KEY;
  const tvKey = process.env.TAVILY_KEY;

  async function tavilySearch(q) {
    if (!tvKey) return '';
    try {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tvKey,
          query: q,
          search_depth: 'basic',
          max_results: 5,
          include_answer: true
        })
      });
      const data = await r.json();
      return data.answer || (data.results || []).map(x => x.title + ': ' + x.content).join('\n\n');
    } catch(e) { return ''; }
  }

  async function callClaude(messages, maxTokens = 4000) {
    const r = await fetch('https://crazyrouter.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${crKey}`,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: maxTokens,
        messages
      })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    return (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  }

  try {
    if (action === 'price') {
      // Берём цену через Tavily — реальные данные
      try {
        const priceData = await tavilySearch(`${ticker} stock price today 2026`);
        // Ищем цену вида $44.80 или 44.80
        const match = priceData.match(/\$\s*([\d]{1,4}\.[\d]{1,2})|(?:^|\s)([\d]{2,4}\.[\d]{1,2})(?:\s|$)/);
        const price = match ? parseFloat(match[1] || match[2]) : null;
        // Ищем 52W High/Low
        const highMatch = priceData.match(/52.week high[^\d]*([\d]+\.[\d]+)/i);
        const lowMatch = priceData.match(/52.week low[^\d]*([\d]+\.[\d]+)/i);
        return res.json({
          price,
          prev: null,
          high52: highMatch ? parseFloat(highMatch[1]) : null,
          low52: lowMatch ? parseFloat(lowMatch[1]) : null,
          marketCap: null
        });
      } catch(e) {}
      return res.json({ price: null });
    }

    if (action === 'search') {
      const result = await tavilySearch(query || '');
      return res.json({ result });
    }

    if (action === 'analyze') {
      if (!crKey) return res.status(500).json({ error: 'No API key' });

      // ШАГ 1: 4 параллельных поиска через Tavily — реальные данные 2026
      const [news, insiders, catalysts, correlations] = await Promise.all([
        tavilySearch(`${ticker} stock price today May 2026`),
        tavilySearch(`${ticker} insider buying SEC Form 4 2026`),
        tavilySearch(`${ticker} earnings news catalyst May 2026`),
        tavilySearch(`${ticker} suppliers leading indicators correlation 2026`)
      ]);

      const rawData = `
=== ЦЕНА И РЫНОК (май 2026) ===
${news || 'нет данных'}

=== ИНСАЙДЕРЫ SEC FORM 4 (2026) ===
${insiders || 'нет данных'}

=== КАТАЛИЗАТОРЫ И СОБЫТИЯ (2026) ===
${catalysts || 'нет данных'}

=== ПОСТАВЩИКИ И КОРРЕЛЯЦИИ (2026) ===
${correlations || 'нет данных'}
`.trim();

      // ШАГ 2: Claude анализирует реальные данные и возвращает JSON
      const analysisPrompt = `${prompt}

РЕАЛЬНЫЕ ДАННЫЕ ИЗ ВЕБ-ПОИСКА (май 2026):
${rawData}

КРИТИЧНО: Используй ТОЛЬКО данные выше. Все цены, события, инсайдеры — только из этих данных за 2026 год. Не используй данные старше января 2026. Если в разделе "ЦЕНА И РЫНОК" есть цена — используй именно её в полях price и priceNum.`;

      const text = await callClaude([{ role: 'user', content: analysisPrompt }], 4000);
      return res.json({ text });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
