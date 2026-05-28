export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, ticker, prompt, query } = req.body;
  const crKey = process.env.CRAZYROUTER_KEY;
  const tvKey = process.env.TAVILY_KEY;

  // Российские тикеры (МОСБИРЖА) — цена в рублях
  const MOEX_TICKERS = ['SBER','SVCB','RUAL','FLNC','LKOH','GAZP','YNDX','NVTK','ROSN','GMKN','MTSS','VTBR','AFLT','POLY','PLZL','MGNT','ALRS','PHOR','NLMK','CHMF','MAGN','ENPL','RTKM','FEES','HYDR','IRAO','MOEX','TCSG','OZON','VKCO','SPBE'];
  const isMoex = MOEX_TICKERS.includes((ticker || '').toUpperCase());

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

  // Универсальное извлечение цены: поддерживает рубли и доллары
  function extractPrice(text: string, moex: boolean): { price: number|null, high52: number|null, low52: number|null } {
    if (!text) return { price: null, high52: null, low52: null };

    let price = null;
    let high52 = null;
    let low52 = null;

    if (moex) {
      // Рублёвая цена: ищем числа без $ или с ₽/руб
      // Примеры: "785.92 rubles", "785,92 ₽", "цена 785.92", "trading at 786"
      const rubPatterns = [
        /(?:₽|руб|rub|ruble)[^\d]*([\d\s]{2,6}[.,][\d]{1,2})/i,
        /([\d\s]{2,6}[.,][\d]{1,2})\s*(?:₽|руб|rub|ruble)/i,
        /(?:price|цена|trading at|стоимость)[^\d]*([\d]{2,6}[.,][\d]{1,2})/i,
        /(?:price|цена|close|last)[^\d$€£]*([\d]{2,6}(?:\.\d{1,2})?)/i,
      ];
      for (const p of rubPatterns) {
        const m = text.match(p);
        if (m) {
          const v = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
          // Для RUAL разумный диапазон: 20-200 руб
          if (v > 5 && v < 10000) { price = v; break; }
        }
      }
      // 52W для рублёвых акций
      const h = text.match(/52.week high[^\d]*([\d]+[.,][\d]*)/i) || text.match(/максимум[^\d]*([\d]+[.,][\d]*)/i);
      const l = text.match(/52.week low[^\d]*([\d]+[.,][\d]*)/i) || text.match(/минимум[^\d]*([\d]+[.,][\d]*)/i);
      if (h) high52 = parseFloat(h[1].replace(',', '.'));
      if (l) low52 = parseFloat(l[1].replace(',', '.'));
    } else {
      // Долларовая цена
      const m = text.match(/\$\s*([\d]{1,5}\.[\d]{1,2})/);
      if (m) price = parseFloat(m[1]);
      const h = text.match(/52.week high[^\d$]*([\d]+\.[\d]+)/i);
      const l = text.match(/52.week low[^\d$]*([\d]+\.[\d]+)/i);
      if (h) high52 = parseFloat(h[1]);
      if (l) low52 = parseFloat(l[1]);
    }

    // ВАЛИДАЦИЯ 52W диапазона: текущая цена не может быть вне диапазона
    if (price && high52 && price > high52) {
      high52 = price * 1.05; // расширяем если цена выше
    }
    if (price && low52 && price < low52) {
      low52 = price * 0.95;
    }

    return { price, high52, low52 };
  }

  try {
    if (action === 'price') {
      try {
        const currency = isMoex ? 'рублей MOEX Московская биржа' : 'USD stock price';
        const priceData = await tavilySearch(`${ticker} ${currency} today 2026`);
        const extracted = extractPrice(priceData, isMoex);
        return res.json({
          price: extracted.price,
          prev: null,
          high52: extracted.high52,
          low52: extracted.low52,
          marketCap: null,
          currency: isMoex ? 'RUB' : 'USD'
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

      // Запросы адаптированы под тип рынка
      const marketQuery = isMoex
        ? `${ticker} акция цена рублей MOEX май 2026`
        : `${ticker} stock price today May 2026`;

      const aluminumQuery = isMoex && ticker === 'RUAL'
        ? `алюминий LME цена 3M фьючерс май 2026 USD per tonne`
        : `${ticker} suppliers leading indicators correlation 2026`;

      const results = await Promise.allSettled([
        tavilySearch(marketQuery),
        tavilySearch(`${ticker} insider buying SEC Form 4 2026`),
        tavilySearch(`${ticker} earnings news catalyst May 2026`),
        tavilySearch(aluminumQuery)
      ]);

      const news        = results[0].status === 'fulfilled' ? results[0].value : '';
      const insiders    = results[1].status === 'fulfilled' ? results[1].value : '';
      const catalysts   = results[2].status === 'fulfilled' ? results[2].value : '';
      const correlations = results[3].status === 'fulfilled' ? results[3].value : '';

      // Извлекаем цену с учётом типа рынка
      const extracted = extractPrice(news, isMoex);
      const currentPrice = extracted.price;
      const currencySymbol = isMoex ? '₽' : '$';

      const priceInstruction = currentPrice
        ? `\n\nВАЖНО: Текущая цена ${ticker} = ${currencySymbol}${currentPrice} (из веб-поиска май 2026, ${isMoex ? 'РУБЛИ - МОСБИРЖА' : 'USD - NYSE/NASDAQ'}). 
Используй именно эту цену в полях price ("${currencySymbol}${currentPrice}") и priceNum (${currentPrice}). 
${isMoex ? 'Все цены в РУБЛЯХ, не в долларах. Биржа: MOEX.' : ''}
НЕ используй другую цену.`
        : '';

      // Для RUAL — добавляем данные по алюминию LME отдельно
      const aluminumNote = (ticker === 'RUAL' && correlations)
        ? `\n\n=== ЦЕНА АЛЮМИНИЯ LME (РЕАЛЬНЫЕ ДАННЫЕ МАЙ 2026) ===\n${correlations}\nВАЖНО: В блоке ПРЕДВОСХИЩЕНИЕ (anticipationInd1) используй РЕАЛЬНУЮ цену алюминия LME из данных выше, не выдумывай.`
        : '';

      const rawData = `
=== ЦЕНА И РЫНОК (май 2026) ===
${news || 'нет данных'}

=== ИНСАЙДЕРЫ SEC FORM 4 (2026) ===
${insiders || 'нет данных'}

=== КАТАЛИЗАТОРЫ И СОБЫТИЯ (2026) ===
${catalysts || 'нет данных'}

=== ПОСТАВЩИКИ И КОРРЕЛЯЦИИ (2026) ===
${correlations || 'нет данных'}
${aluminumNote}`.trim();

      const analysisPrompt = `${prompt}

РЕАЛЬНЫЕ ДАННЫЕ ИЗ ВЕБ-ПОИСКА (май 2026):
${rawData}
${priceInstruction}

КРИТИЧНО: Используй ТОЛЬКО данные выше. Все цены, события, инсайдеры — только из этих данных за 2026 год.
${isMoex ? `БИРЖА МОСБИРЖА: цена в РУБЛЯХ (₽), не в долларах. exchange: "MOEX"` : ''}`;

      const text = await callClaude([{ role: 'user', content: analysisPrompt }], 4000);
      return res.json({ text });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
