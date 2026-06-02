// Vercel: дефолт 10с убивает тяжёлый analyze. 180с даёт медленному crazyrouter время ответить.
// ВАЖНО: значение >60 работает ТОЛЬКО при включённом Fluid Compute (Settings → Functions).
// Без Fluid Compute Vercel молча обрежет до 60с.
export const config = { maxDuration: 180 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, ticker, prompt, query } = req.body;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;            // прямой Anthropic (приоритет)
  const crKey = anthropicKey || process.env.CRAZYROUTER_KEY;     // gate "есть ли LLM-ключ" — работает для обоих
  const tvKey = process.env.TAVILY_KEY;
  const fmpKey = process.env.FMP_KEY;

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
    // Провайдер: ANTHROPIC_API_KEY → прямой Anthropic (надёжно). Иначе — crazyrouter (прокси, нестабилен).
    const direct = !!anthropicKey;
    const url = direct ? 'https://api.anthropic.com/v1/messages' : 'https://crazyrouter.com/v1/messages';
    const headers = direct
      ? { 'content-type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' }
      : { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + crKey, 'anthropic-version': '2023-06-01' };
    const who = direct ? 'Anthropic' : 'crazyrouter';
    // Жёсткий таймаут НИЖЕ лимита функции (180с): даём провайдеру до 170с ответить,
    // зависший падает чистой ошибкой, а не убивается платформой Vercel.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 170000);
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: maxTokens, messages }),
        signal: ctrl.signal
      });
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') throw new Error(who + ' не ответил за 170с (перегружен/недоступен) — повтори запрос');
      throw new Error(who + ' недоступен: ' + (e?.message || String(e)));
    }
    clearTimeout(timer);
    const raw = await r.text();
    let d;
    try { d = JSON.parse(raw); }
    catch { throw new Error(who + ' вернул не-JSON (HTTP ' + r.status + '): ' + raw.slice(0, 160)); }
    if (d.error) throw new Error((d.error.message || JSON.stringify(d.error)) + ' [' + who + ']');
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
      new RegExp(tickerName + '[^0-9]{1,30}([0-9]{2,6}[.,][0-9]{1,2})', 'gi'),
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

    // Распознавание тикера по тикеру ИЛИ названию компании (русский/английский)
    if (action === 'resolve') {
      const raw = (ticker || '').trim();
      if (!raw) return res.json({ ticker: '', name: '' });
      if (!crKey) return res.json({ ticker: raw.toUpperCase(), name: '' });
      try {
        const r = await callClaude([{ role: 'user', content:
          'Определи биржевой тикер по вводу пользователя (это тикер ИЛИ название компании на русском/английском): "' + raw + '".\n' +
          'Правила:\n' +
          '- Российские компании → тикер MOEX (Сбербанк→SBER, Совкомбанк→SVCB, Лукойл→LKOH, Газпром→GAZP, Норникель→GMKN, Яндекс→YDEX, Новатэк→NVTK).\n' +
          '- Иностранные компании → тикер основной биржи (Nike→NKE, Найк→NKE, Apple→AAPL, Эппл→AAPL, Tesla→TSLA, Тесла→TSLA).\n' +
          '- Если ввод УЖЕ корректный биржевой тикер — верни его без изменений.\n' +
          '- Ответь СТРОГО одной строкой JSON без markdown: {"ticker":"XXX","name":"Полное название"}.\n' +
          '- Если определить невозможно — {"ticker":"' + raw.toUpperCase() + '","name":""}.' }], 80);
        const clean = (r || '').replace(/```json|```/g, '').trim();
        const m = clean.match(/\{[\s\S]*\}/);
        const obj = m ? JSON.parse(m[0]) : {};
        const t = String(obj.ticker || raw).toUpperCase().replace(/[^A-Z0-9.]/g, '');
        return res.json({ ticker: t || raw.toUpperCase(), name: obj.name || '' });
      } catch (e) {
        return res.json({ ticker: raw.toUpperCase(), name: '' });
      }
    }

    if (action === 'analyze') {
      if (!crKey) return res.status(500).json({ error: 'No API key' });

      const marketQuery = isMoex
        ? ticker + ' MOEX акция цена рублей котировка май 2026'
        : ticker + ' stock price today May 2026';

      const corrQuery = ticker + ' suppliers leading indicators correlation 2026';

      const insiderQuery = isMoex
        ? ticker + ' инсайдеры крупный акционер сделки покупка продажа дата 2025 2026 МосБиржа раскрытие'
        : ticker + ' insider transactions Form 4 SEC OpenInsider buy sell date shares 2025 2026';

      // Словарь опережающих индикаторов для каждого тикера
      const LEADING_INDICATOR_QUERIES = {
        // Металлы и сырьё
        'RUAL': 'aluminum LME price 3M futures today May 2026 USD per tonne',
        'FCX':  'copper LME spot price futures May 2026 USD per tonne',
        'NEM':  'gold spot price XAU May 2026 USD per ounce',
        'GMKN': 'palladium nickel LME price May 2026 USD',
        'NLMK': 'steel HRC price European market May 2026',
        'CHMF': 'steel billet price Russia export May 2026',
        // Энергетика
        'CEG':  'PJM electricity wholesale price May 2026 nuclear power',
        'VST':  'ERCOT Texas electricity spot price May 2026',
        'OKLO': 'nuclear energy policy SMR permits USA 2026',
        'UEC':  'uranium spot price UX May 2026 USD per pound',
        'CCJ':  'uranium spot price Cameco contract May 2026 USD per pound',
        'PBR':  'Brent crude oil price Brazil pre-salt May 2026',
        'LKOH': 'Brent crude oil price Urals May 2026 USD barrel',
        'ROSN': 'Brent Urals oil price Russia export May 2026',
        'NVTK': 'LNG natural gas price Europe TTF May 2026',
        'GAZP': 'natural gas price Russia Europe TTF May 2026',
        // Технологии и телеком
        'NOK':  'Nokia 5G contracts revenue telecom infrastructure 2026',
        'RKLB': 'rocket launch market satellite commercial contracts 2026',
        'FLNC': 'battery storage energy grid demand USA 2026',
        // Потребительский сектор
        'NKE':  'Nike footwear retail sales consumer spending USA Q2 2026',
        'TTWO': 'GTA VI release date Take-Two gaming revenue 2026',
        // Финансы
        'SBER': 'ключевая ставка ЦБ РФ май 2026 банковский сектор',
        'SVCB': 'Совкомбанк финансовые результаты прибыль 2026',
        'TCSG': 'Т-Банк финансовые результаты клиенты 2026',
        // Дефолтный запрос
        'DEFAULT': ticker + ' suppliers supply chain input cost factory orders leading demand indicator May 2026'
      };

      const leadingQuery = LEADING_INDICATOR_QUERIES[ticker.toUpperCase()] || LEADING_INDICATOR_QUERIES['DEFAULT'];

      // Отдельный запрос на ПОДТВЕРЖДЁННУЮ дату ближайшего отчёта/событий
      const catalystQuery = isMoex
        ? ticker + ' дата отчёта МСФО РСБУ 2026 дивиденды календарь событий точная дата'
        : ticker + ' next earnings date confirmed report calendar 2026 dividend ex-date catalyst';

      const results = await Promise.allSettled([
        tavilySearch(marketQuery),
        tavilySearch(insiderQuery),
        tavilySearch(catalystQuery),
        tavilySearch(corrQuery),
        tavilySearch(leadingQuery)
      ]);

      const news         = results[0].status === 'fulfilled' ? results[0].value : '';
      const insiders     = results[1].status === 'fulfilled' ? results[1].value : '';
      const catalysts    = results[2].status === 'fulfilled' ? results[2].value : '';
      const correlations = results[3].status === 'fulfilled' ? results[3].value : '';
      const leadingData  = results[4] && results[4].status === 'fulfilled' ? results[4].value : '';

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

      // БАГ 3 FIX: инструкция по инсайдерам — только реальные сделки с датой
      const insiderInstruction = '\n\nПОЛЕ insiders: бери ТОЛЬКО реальные сделки из веб-данных (Form 4 / OpenInsider / официальные раскрытия). Для каждой: name, role, type (buy/sell), amount, shares, date — точная дата сделки из Form 4 (формат "15 июн 2026"); если сделка есть в данных, но точной даты нет — укажи хотя бы месяц ("июн 2026"). НЕ показывай сделку, которой НЕТ в веб-данных. Нет подтверждённых сделок с источником — верни []. НИКОГДА не выдумывай инсайдеров, даты, суммы и количество акций.';

      // ДАТЫ И СОБЫТИЯ — точность + достаточное количество
      const dateInstruction =
        '\n\n=== СОБЫТИЯ И ДАТЫ (ТОЧНОСТЬ) ===' +
        '\nСегодня 29 мая 2026.' +
        ' В events дай 4-6 событий: недавние подтверждённые факты (прошедшие отчёты/события с реальными датами — это контекст, urgent=false) И будущие катализаторы.' +
        ' Даты в events.date и insiders.date — ТОЛЬКО реальные из веб-данных (формат "15 июн 2026").' +
        ' Если точной даты будущего события в данных нет — напиши "ожидается Q3 2026" и т.п., но НЕ выдумывай конкретное число.' +
        ' urgent=true — только для подтверждённых будущих событий в пределах ~30 дней. Прошедшие события НИКОГДА не помечай urgent.';

      // Базовая инструкция ПРЕДВОСХИЩЕНИЯ — для ЛЮБОГО тикера (есть он в словаре или нет)
      const anticipationInstruction =
        '\n\n=== БЛОК ПРЕДВОСХИЩЕНИЕ — 5 ИНДИКАТОРОВ (ОБЯЗАТЕЛЬНО) ===' +
        '\nПострой причинно-следственную цепочку ВВЕРХ по поставкам для ' + ticker + ':' +
        ' поставщики и их заказы, входное сырьё и его цены, загрузка фабрик/OEM-подрядчиков,' +
        ' законтрактованный пайплайн, опережающие сигналы спроса, регуляторные/тендерные решения.' +
        ' Эталон логики: заказы тайваньских OEM (Feng Tay, Pou Chen) опережают выручку Nike на 1-2 квартала —' +
        ' примени ТАКУЮ ЖЕ логику к ' + ticker + '.' +
        ' Заполни anticipationInd1..anticipationInd5: название индикатора + механизм связи + лаг опережения.' +
        ' ТОЧНОСТЬ: конкретные числа бери ТОЛЬКО из веб-данных ниже; нет числа — опиши механизм качественно, без выдуманных цифр.';

      // Опережающий индикатор — реальные числа для словарных тикеров
      const leadingNote = leadingData
        ? '\n\n=== ОПЕРЕЖАЮЩИЙ ИНДИКАТОР (РЕАЛЬНЫЕ ДАННЫЕ МАЙ 2026) ===\n' + leadingData +
          '\nИспользуй эти реальные числа в anticipationInd1..5 где релевантно. НЕ бери данные из памяти.'
        : '';

      const rawData = [
        '=== ЦЕНА И РЫНОК (май 2026) ===', news || 'нет данных', '',
        '=== ИНСАЙДЕРЫ И МАЖОРИТАРИИ (2025-2026) ===', insiders || 'нет данных', '',
        '=== КАТАЛИЗАТОРЫ И СОБЫТИЯ (2026) ===', catalysts || 'нет данных', '',
        '=== КОРРЕЛЯЦИИ И ПОСТАВЩИКИ ===', correlations || 'нет данных',
        leadingNote
      ].join('\n').trim();

      const analysisPrompt = prompt +
        '\n\nРЕАЛЬНЫЕ ДАННЫЕ ИЗ ВЕБ-ПОИСКА (май 2026):\n' + rawData +
        priceInstruction + insiderInstruction + anticipationInstruction + dateInstruction +
        '\n\nКРИТИЧНО: Используй ТОЛЬКО данные выше. Все цены — только из этих данных.' +
        (isMoex ? '\nБИРЖА МОСБИРЖА: цена РУБЛИ (₽). exchange="MOEX".' : '');

      const text = await callClaude([{ role: 'user', content: analysisPrompt }], 5000);
      return res.json({ text });
    }

    // СКРИНЕР через FMP (free 250/день)
    if (action === 'screen') {
      if (!fmpKey) return res.json({ error: 'FMP_KEY не задан в окружении', results: [] });
      const f = req.body.filters || {};
      const params = new URLSearchParams();
      if (f.marketCapMoreThan) params.set('marketCapMoreThan', String(f.marketCapMoreThan));
      if (f.priceMoreThan)     params.set('priceMoreThan', String(f.priceMoreThan));
      if (f.priceLowerThan)    params.set('priceLowerThan', String(f.priceLowerThan));
      if (f.volumeMoreThan)    params.set('volumeMoreThan', String(f.volumeMoreThan));
      if (f.betaMoreThan)      params.set('betaMoreThan', String(f.betaMoreThan));
      if (f.dividendMoreThan)  params.set('dividendMoreThan', String(f.dividendMoreThan));
      if (f.sector)            params.set('sector', String(f.sector));
      if (f.exchange)          params.set('exchange', String(f.exchange));
      if (f.country)           params.set('country', String(f.country));
      params.set('isActivelyTrading', 'true');
      params.set('limit', String(f.limit || 30));
      params.set('apikey', fmpKey);

      // FMP перевёл скринер на /stable/. v3 теперь legacy и на НОВЫХ ключах
      // часто отвечает ошибкой "legacy only". Бьём stable, при сбое — один раз v3.
      const STABLE = 'https://financialmodelingprep.com/stable/company-screener?';
      const V3 = 'https://financialmodelingprep.com/api/v3/stock-screener?';
      const tryScreen = async (base) => {
        const r = await fetch(base + params.toString());
        return r.json();
      };

      try {
        let data = await tryScreen(STABLE);
        if (!Array.isArray(data)) {
          // stable не отдал список → пробуем legacy v3
          const v3data = await tryScreen(V3);
          if (Array.isArray(v3data)) {
            data = v3data;
          } else {
            const msg = (data && (data['Error Message'] || data.error || data.message))
              || (v3data && (v3data['Error Message'] || v3data.error || v3data.message))
              || 'FMP вернул не список (проверь ключ/лимит)';
            return res.json({ error: msg, results: [] });
          }
        }
        const results = data.slice(0, f.limit || 30).map((x) => ({
          symbol: x.symbol,
          name: x.companyName || '',
          price: x.price ?? null,
          marketCap: x.marketCap ?? null,
          sector: x.sector || '',
          industry: x.industry || '',
          volume: x.volume ?? null,
          beta: x.beta ?? null,
          exchange: x.exchangeShortName || x.exchange || '',
          country: x.country || ''
        }));
        return res.json({ results });
      } catch (e) {
        return res.json({ error: e.message || 'Ошибка запроса к FMP', results: [] });
      }
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
