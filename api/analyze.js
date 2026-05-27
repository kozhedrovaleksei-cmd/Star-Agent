export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, ticker, prompt, priceData } = req.body;
  const crKey = process.env.CRAZYROUTER_KEY;
  const fcKey = process.env.FIRECRAWL_KEY;

  try {
    // 1. Получение цены Yahoo Finance
    if (action === 'price') {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`, { 
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

    // 2. Инсайдеры
    if (action === 'insiders') {
      if (!fcKey) return res.json({ result: 'No Firecrawl key' });
      const r = await fetch('https://api.firecrawl.dev/v1/scrape', { 
        method: 'POST', 
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${fcKey}` 
        }, 
        body: JSON.stringify({ 
          url: `https://openinsider.com/search?q=${ticker}`, 
          formats: ['markdown'], 
          onlyMainContent: true, 
          waitFor: 2500 
        }) 
      });
      const data = await r.json();
      return res.json({ result: (data?.data?.markdown || '').slice(0, 2800) });
    }

    // 3. УНИВЕРСАЛЬНЫЙ АНАЛИЗ — ГЛАВНАЯ ФУНКЦИЯ
    if (action === 'analyze') {
      if (!crKey) return res.status(500).json({ error: 'No Crazyrouter key' });

      const currentPriceInfo = priceData?.price 
        ? `Текущая цена на 27 мая 2026: $${priceData.price} (52w Low/High: $${priceData.low52}–$${priceData.high52}, Market Cap: $${(priceData.marketCap/1e9).toFixed(1)}B)` 
        : '';

      const fullPrompt = `
Ты — STARK AI. Главный edge — скрытые корреляции и лаговые зависимости 3-6-12 месяцев.
Анализируй ${ticker} прямо сейчас. ${currentPriceInfo}

Сначала вызови web_search по ключевым запросам.

Выдай ответ **строго** в следующем формате:

⚡ STARK АНАЛИЗ ${ticker.toUpperCase()}

**Текущие данные** (27 мая 2026)
Цена: $X | 52w: $A–$B | Market Cap: $Y

**БЫЧИЙ КЕЙС** (X/10)
• Ключевые драйверы
• ...

**МЕДВЕЖИЙ КЕЙС** (X/10)
• ...

**ВЕРДИКТ STARK — X УРОВНЕЙ**
[Жёсткий вывод + рекомендация: НАКАПЛИВАТЬ / ОТКРЫВАТЬ / НАБЛЮДАТЬ / ПРОДАВАТЬ]

**R:R** — X:1 | Стоп: $Z | Рекомендуемый вес: X%

**ЦЕЛИ**:
- Цель 1: $XX (+XX%) — до [дата/период]
- Цель 2: $YY (+XX%) — 6-9 мес
- Цель 3: $ZZ (+XX%) — 12-18 мес

**ПРЕДВОСХИЩЕНИЕ — ЧТО РЫНОК ЕЩЁ НЕ ВИДИТ**
1. Индикатор 1 (лаг X): ...
2. Индикатор 2 (лаг X): ...
3. Скрытая корреляция (кластер): ...

**ФИНАЛЬНЫЙ ВЕРДИКТ STARK**
[Сильный вывод]
ВОТ ТАК ЗАКАЛЯЕТСЯ ХАРАКТЕР.
`;

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
          max_tokens: 9000, 
          tools: [{ type: 'web_search_20250305', name: 'web_search' }], 
          messages: [{ role: 'user', content: fullPrompt }] 
        })
      });

      const d1 = await r1.json();

      let finalText = '';

      const hasToolUse = (d1.content || []).some(b => b.type === 'tool_use');
      
      if (hasToolUse) {
        const toolResults = (d1.content || []).filter(b => b.type === 'tool_use')
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
            max_tokens: 9000, 
            tools: [{ type: 'web_search_20250305', name: 'web_search' }], 
            messages: [
              { role: 'user', content: fullPrompt }, 
              { role: 'assistant', content: d1.content }, 
              { role: 'user', content: toolResults }
            ] 
          })
        });
        const d2 = await r2.json();
        finalText = (d2.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      } else {
        finalText = (d1.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      }

      return res.json({ text: finalText });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
