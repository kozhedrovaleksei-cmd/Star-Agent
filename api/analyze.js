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

  // ── Текущая дата ──────────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];           // "2026-05-27"
  const monthYear = new Date().toLocaleString('en-US', {          // "May 2026"
    month: 'long', year: 'numeric', timeZone: 'UTC'
  });

  // ── Системный промпт с датой ───────────────────────────────────────────────
  const SYSTEM = `Today is ${today} (${monthYear}). \
You are STARK AI — elite trader with 14 years of experience. \
All data you search and return MUST be from ${monthYear} or later. \
Reject any information dated before ${today.slice(0, 7)}. \
Method: hidden correlations + lag dependencies 3-6-12 months. \
Think in clusters: event → indicator → sector → asset. \
Use web_search IMMEDIATELY. Never start without searching. \
First character of every response: ⚡️`;

  // ── МОДЕЛЬ ────────────────────────────────────────────────────────────────
  const MODEL = 'claude-sonnet-4-6';

  try {

    // ── Yahoo Finance ────────────────────────────────────────────────────────
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

    // ── Tavily search ────────────────────────────────────────────────────────
    if (action === 'search') {
      if (!tvKey) return res.json({ result: '' });
      // Автоматически добавляем год к запросу если его нет
      const enrichedQuery = query && !query.includes('2026')
        ? `${query} ${monthYear}`
        : (query || '');
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tvKey,
          query: enrichedQuery,
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

    // ── Firecrawl scrape ─────────────────────────────────────────────────────
    if (action === 'scrape') {
      if (!fcKey || !url) return res.json({ result: '' });
      const r = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${fcKey}` },
        body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, waitFor: 2000 })
      });
      const data = await r.json();
      return res.json({ result: (data?.data?.markdown || '').slice(0, 3000) });
    }

    // ── Firecrawl insiders (OpenInsider) ─────────────────────────────────────
    if (action === 'insiders') {
      if (!fcKey) return res.json({ result: '' });
      const r = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${fcKey}` },
        body: JSON.stringify({
          url: `https://openinsider.com/search?q=${ticker}`,
          formats: ['markdown'],
          onlyMainContent: true,
          waitFor: 2000
        })
      });
      const data = await r.json();
      return res.json({ result: (data?.data?.markdown || '').slice(0, 2000) });
    }

    // ── Claude analyze WITH web_search ────────────────────────────────────────
    if (action === 'analyze') {
      if (!crKey) return res.status(500).json({ error: 'No API key' });

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${crKey}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      };

      const tools = [{ type: 'web_search_20250305', name: 'web_search' }];

      // Обогащаем промпт датой если не указана
      const enrichedPrompt = prompt && !prompt.includes('2026')
        ? `[Today: ${today}]\n\n${prompt}`
        : (prompt || '');

      // Шаг 1 — первый запрос
      const r1 = await fetch('https://crazyrouter.com/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 8000,
          system: SYSTEM,
          tools,
          messages: [{ role: 'user', content: enrichedPrompt }]
        })
      });
      const d1 = await r1.json();

      if (d1.error) return res.status(500).json({ error: d1.error.message });

      const hasToolUse = (d1.content || []).some(b => b.type === 'tool_use');

      // Шаг 2 — если был tool_use, отправляем результаты обратно
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
          headers,
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 8000,
            system: SYSTEM,
            tools,
            messages: [
              { role: 'user', content: enrichedPrompt },
              { role: 'assistant', content: d1.content },
              { role: 'user', content: toolResults }
            ]
          })
        });
        const d2 = await r2.json();
        if (d2.error) return res.status(500).json({ error: d2.error.message });
        return res.json({
          text: (d2.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
        });
      }

      return res.json({
        text: (d1.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
      });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
