export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, ticker, prompt, query } = req.body;
  const crKey = process.env.CRAZYROUTER_KEY;
  const tvKey = process.env.TAVILY_KEY;

  const MOEX_TICKERS = ['SBER','SVCB','RUAL','FLNC','LKOH','GAZP','YNDX','NVTK','ROSN','GMKN','MTSS','VTBR','AFLT','POLY','PLZL','MGNT','ALRS','PHOR','NLMK','CHMF','MAGN','RTKM','FEES','HYDR','IRAO','MOEX','TCSG','OZON','VKCO'];
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

  async function callClaude(messages, maxTokens) {
    maxTokens = maxTokens || 4000;
    const r = await fetch('https://crazyrouter.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + crKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: maxTokens, messages })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
    return (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  }

  // БАГ 1 FIX: извлечение рублёвой цены MOEX
  // RUAL торгуется ~30-80 руб, SBER ~280-340, LKOH ~6000-8000
  // Tavily часто возвращает HKD цену для RUAL (~1.8 HKD) — фильтруем
  function extractMoexPrice(text, tickerName) {
    if (!text) return { price: null, high52: null, low52: null };

    // Диапазоны разумных цен для известных тикеров в рублях
    const PRICE_RANGES = {
      'RUAL': [15, 150],
      'SBER': [150, 500],
      'SVCB': [8, 30],
      'FLNC': [50, 300],
      'GAZP': [100, 400],
      'LKOH': [4000, 10000],
      'GMKN': [10000, 25000],
      'NVTK': [800, 2000],
    };
    const range = PRICE_RANGES[tickerName] || [1, 100000];

    let price = null;
    let high52 = null;
    let low52 = null;

    // Ищем числа рядом с рублёвыми маркерами
    const rubPatterns = [
      // "47.50 ₽" или "₽ 47.50"
      /(?:₽|руб\.?|RUB)\s*([\d\s]{1,8}[.,]?\d{0,2})/gi,
      /([\d\s]{1,8}[.,]\d{1,2})\s*(?:₽|руб\.?|RUB)/gi,
      // "цена: 47.50" или "price: 47.50" или "торгуется по 47"
      /(?:цена|стоимость|котировка|торгуется по|last price|close)[:\s]+([0-9]{2,6}[.,]?[0-9]{0,2})/gi,
      // просто число в разумном диапазоне после тикера
      new RegExp(tickerName + '[^0-9]{1,30}([0-9]{2,6}[.,][0-9]{1,2})', 'i'),
    ];

    for (let i = 0; i < rubPatterns.length; i++) {
      const matches = [...text.matchAll(rubPatterns[i])];
      for (const m of matches) {
        const v = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
        if (v >= range[0] && v <= range[1]) { price = v; break; }
      }
      if (price) break;
    }

    // 52W диапазон
    const h52 = text.match(/52.{0,10}(?:high|max|макс)[^\d]*([\d]+[.,][\d]*)/i);
    const l52 = text.match(/52.{0,10}(?:low|min|мин)[^\d]*([\d]+[.,][\d]*)/i);
    if (h52) { const v = parseFloat(h52[1].replace(',','.')); if (v >= range[0] && v <= range[1]*1.5) high52 = v; }
    if (l52) { const v = parseFloat(l52[1].replace(',','.')); if (v >= range[0]*0.5 && v <= range[1]) low52 = v; }

    // Валидация слайдера: цена всегда внутри диапазона
    if (price && high52 && price > high52) high52 = Math.round(price * 1.08 * 100) / 100;
    if (price && low52 && price < low52) low52 = Math.round(price * 0.92 * 100) / 100;
    // Если нет диапазона — строим вокруг цены
    if (price && !high52) high52 = Math.round(price * 1.3 * 100) / 100;
    if (price && !low52) low52 = Math.round(price * 0.7 * 100) / 100;

    return { price, high52, low52 };
  }

  function extractUsdPrice(text) {
    if (!text) return { price: null, high52: null, low52: null };
    const m = text.match(/\$\s*([\d]{1,5}\.[\d]{1,2})/);
    const price = m ? parseFloat(m[1]) : null;
    const h = text.match(/52.week high[^\d$]*([\d]+\.[\d]+)/i);
    const l = text.match(/52.week low[^\d$]*([\d]+\.[\d]+)/i);
    let high52 = h ? parseFloat(h[1]) : null;
    let low52 = l ? parseFloat(l[1]) : null;
    if (price && high52 && price > high52) high52 = Math.round(price * 1.08 * 100) / 100;
    if (price && low52 && price < low52) low52 = Math.round(price * 0.92 * 100) / 100;
    if (price && !high52) high52 = Math.round(price * 1.3 * 100) / 100;
    if (price && !low52) low52 = Math.round(price * 0.7 * 100) / 100;
    return { price, high52, low52 };
  }

  try {
    if (action === 'price') {
      try {
        // БАГ 1 FIX: для RUAL используем очень специфичный запрос на русском
        const searchQ = isMoex
          ? ticker + ' MOEX акция цена рублей сегодня котировка'
          : ticker + ' stock price today 2026';
        const priceData = await tavilySearch(searchQ);
        const extracted = isMoex
          ? extractMoexPrice(priceData, (ticker||'').toUpperCase())
          : extractUsdPrice(priceData);
        return res.json({
          price: extracted.price,
          high52: extracted.high52,
          low52: extracted.low52,
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

      const marketQuery = isMoex
        ? ticker + ' MOEX акция цена рублей котировка май 2026'
        : ticker + ' stock price today May 2026';

      const corrQuery = (ticker === 'RUAL')
        ? 'алюминий LME цена 3M фьючерс USD tonne май 2026 aluminum price LME'
        : ticker + ' suppliers leading indicators correlation 2026';

      // БАГ 3 FIX: отдельный запрос по инсайдерам на русском для MOEX
      const insiderQuery = isMoex
        ? ticker + ' инсайдеры покупка акций мажоритарий 2025 2026 МОЕХ'
        : ticker + ' insider buying SEC Form 4 2025 2026';

      const results = await Promise.allSettled([
        tavilySearch(marketQuery),
        tavilySearch(insiderQuery),
        tavilySearch(ticker + ' earnings news catalyst May 2026'),
        tavilySearch(corrQuery)
      ]);

      const news         = results[0].status === 'fulfilled' ? results[0].value : '';
      const insiders     = results[1].status === 'fulfilled' ? results[1].value : '';
      const catalysts    = results[2].status === 'fulfilled' ? results[2].value : '';
      const correlations = results[3].status === 'fulfilled' ? results[3].value : '';

      const extracted = isMoex
        ? extractMoexPrice(news, (ticker||'').toUpperCase())
        : extractUsdPrice(news);
      const currentPrice = extracted.price;
      const currencySymbol = isMoex ? '₽' : '$';

      const priceInstruction = currentPrice
        ? '\n\nВАЖНО: Текущая цена ' + ticker + ' = ' + currencySymbol + currentPrice +
          ' (из веб-поиска май 2026, ' + (isMoex ? 'РУБЛИ МОСБИРЖА' : 'USD') + ').' +
          ' Используй ТОЛЬКО эту цену: price="' + currencySymbol + currentPrice + '", priceNum=' + currentPrice + '.' +
          (isMoex ? ' ВСЕ цены в РУБЛЯХ ₽. exchange="MOEX".' : '') +
          ' НЕ используй другие числа как цену акции.'
        : '';

      // БАГ 3 FIX: инструкция по инсайдерам
      const insiderInstruction = '\n\nДЛЯ ПОЛЯ insiders: если есть данные по инсайдерам — заполни name, role, type (buy/sell), amount (например "₽2.5 млрд" или "$500K"), shares (количество акций), date. Если данных нет — верни пустой массив []. НЕ придумывай нулевые значения.';

      const aluminumNote = (ticker === 'RUAL' && correlations)
        ? '\n\n=== ЦЕНА АЛЮМИНИЯ LME МАЙ 2026 ===\n' + correlations +
          '\nВАЖНО: В anticipationInd1 используй РЕАЛЬНУЮ цену алюминия LME из данных выше.'
        : '';

      const rawData = [
        '=== ЦЕНА И РЫНОК (май 2026) ===', news || 'нет данных', '',
        '=== ИНСАЙДЕРЫ И МАЖОРИТАРИИ (2025-2026) ===', insiders || 'нет данных', '',
        '=== КАТАЛИЗАТОРЫ И СОБЫТИЯ (2026) ===', catalysts || 'нет данных', '',
        '=== КОРРЕЛЯЦИИ И ПОСТАВЩИКИ ===', correlations || 'нет данных',
        aluminumNote
      ].join('\n').trim();

      const analysisPrompt = prompt +
        '\n\nРЕАЛЬНЫЕ ДАННЫЕ ИЗ ВЕБ-ПОИСКА (май 2026):\n' + rawData +
        priceInstruction + insiderInstruction +
        '\n\nКРИТИЧНО: Используй ТОЛЬКО данные выше. Все цены — только из этих данных.' +
        (isMoex ? '\nБИРЖА МОСБИРЖА: цена РУБЛИ (₽). exchange="MOEX".' : '');

      const text = await callClaude([{ role: 'user', content: analysisPrompt }], 4000);
      return res.json({ text });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
