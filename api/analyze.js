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

  function extractPrice(text, moex) {
    if (!text) return { price: null, high52: null, low52: null };

    let price = null;
    let high52 = null;
    let low52 = null;

    if (moex) {
      // Рублёвые паттерны
      const rubPatterns = [
        /(?:₽|руб|rub|ruble)[^\d]*([\d\s]{1,6}[.,][\d]{1,2})/i,
        /([\d\s]{1,6}[.,][\d]{1,2})\s*(?:₽|руб|rub|ruble)/i,
        /(?:price|цена|trading at|стоимость|last|close)[^\d$€£]*([\d]{2,6}(?:[.,]\d{1,2})?)/i,
      ];
      for (let i = 0; i < rubPatterns.length; i++) {
        const m = text.match(rubPatterns[i]);
        if (m) {
          const v = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
          if (v > 5 && v < 100000) { price = v; break; }
        }
      }
      const h = text.match(/52.week high[^\d]*([\d]+[.,][\d]*)/i) || text.match(/52.{0,5}high[^\d]*([\d]+[.,][\d]*)/i);
      const l = text.match(/52.week low[^\d]*([\d]+[.,][\d]*)/i) || text.match(/52.{0,5}low[^\d]*([\d]+[.,][\d]*)/i);
      if (h) high52 = parseFloat(h[1].replace(',', '.'));
      if (l) low52 = parseFloat(l[1].replace(',', '.'));
    } else {
      const m = text.match(/\$\s*([\d]{1,5}\.[\d]{1,2})/);
      if (m) price = parseFloat(m[1]);
      const h = text.match(/52.week high[^\d$]*([\d]+\.[\d]+)/i);
      const l = text.match(/52.week low[^\d$]*([\d]+\.[\d]+)/i);
      if (h) high52 = parseFloat(h[1]);
      if (l) low52 = parseFloat(l[1]);
    }

    // Валидация: цена не может быть вне 52W диапазона
    if (price !== null && high52 !== null && price > high52) high52 = Math.round(price * 1.05 * 100) / 100;
    if (price !== null && low52 !== null && price < low52) low52 = Math.round(price * 0.95 * 100) / 100;

    return { price, high52, low52 };
  }

  try {
    if (action === 'price') {
      try {
        const searchQ = isMoex
          ? ticker + ' акция цена рублей MOEX Московская биржа 2026'
          : ticker + ' stock price today 2026';
        const priceData = await tavilySearch(searchQ);
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

      const marketQuery = isMoex
        ? ticker + ' акция цена рублей MOEX май 2026'
        : ticker + ' stock price today May 2026';

      const corrQuery = (ticker === 'RUAL')
        ? 'алюминий LME цена 3M фьючерс USD tonne май 2026 aluminum price'
        : ticker + ' suppliers leading indicators correlation 2026';

      const results = await Promise.allSettled([
        tavilySearch(marketQuery),
        tavilySearch(ticker + ' insider buying SEC Form 4 2026'),
        tavilySearch(ticker + ' earnings news catalyst May 2026'),
        tavilySearch(corrQuery)
      ]);

      const news        = results[0].status === 'fulfilled' ? results[0].value : '';
      const insiders    = results[1].status === 'fulfilled' ? results[1].value : '';
      const catalysts   = results[2].status === 'fulfilled' ? results[2].value : '';
      const correlations = results[3].status === 'fulfilled' ? results[3].value : '';

      const extracted = extractPrice(news, isMoex);
      const currentPrice = extracted.price;
      const currencySymbol = isMoex ? '₽' : '$';

      const priceInstruction = currentPrice
        ? '\n\nВАЖНО: Текущая цена ' + ticker + ' = ' + currencySymbol + currentPrice +
          ' (из веб-поиска май 2026, ' + (isMoex ? 'РУБЛИ - МОСБИРЖА' : 'USD') + ').' +
          ' Используй именно эту цену в полях price ("' + currencySymbol + currentPrice + '") и priceNum (' + currentPrice + ').' +
          (isMoex ? ' Все цены в РУБЛЯХ ₽, не в долларах. exchange: "MOEX".' : '') +
          ' НЕ используй другую цену.'
        : '';

      const aluminumNote = (ticker === 'RUAL' && correlations)
        ? '\n\n=== ЦЕНА АЛЮМИНИЯ LME МАЙ 2026 (РЕАЛЬНЫЕ ДАННЫЕ) ===\n' + correlations +
          '\nВАЖНО: В поле anticipationInd1 используй РЕАЛЬНУЮ цену алюминия LME из данных выше.'
        : '';

      const rawData = [
        '=== ЦЕНА И РЫНОК (май 2026) ===',
        news || 'нет данных',
        '',
        '=== ИНСАЙДЕРЫ SEC FORM 4 (2026) ===',
        insiders || 'нет данных',
        '',
        '=== КАТАЛИЗАТОРЫ И СОБЫТИЯ (2026) ===',
        catalysts || 'нет данных',
        '',
        '=== ПОСТАВЩИКИ И КОРРЕЛЯЦИИ (2026) ===',
        correlations || 'нет данных',
        aluminumNote
      ].join('\n').trim();

      const analysisPrompt = prompt + '\n\nРЕАЛЬНЫЕ ДАННЫЕ ИЗ ВЕБ-ПОИСКА (май 2026):\n' + rawData +
        priceInstruction +
        '\n\nКРИТИЧНО: Используй ТОЛЬКО данные выше. Все цены и события — только из этих данных за 2026 год.' +
        (isMoex ? '\nБИРЖА МОСБИРЖА: цена в РУБЛЯХ (₽), не в долларах. Поле exchange: "MOEX".' : '');

      const text = await callClaude([{ role: 'user', content: analysisPrompt }], 4000);
      return res.json({ text });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
