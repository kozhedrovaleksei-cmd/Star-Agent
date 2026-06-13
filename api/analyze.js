// Vercel: дефолт 10с убивает тяжёлый analyze. 180с даёт медленному crazyrouter время ответить.
// ВАЖНО: значение >60 работает ТОЛЬКО при включённом Fluid Compute (Settings → Functions).
// Без Fluid Compute Vercel молча обрежет до 60с.
export const config = { maxDuration: 180 };

// ====== LEVEL SCANNER (action 'levelscan') — STARK, выбираемый таймфрейм S/R ======
const LS_PIVOT_K     = 3;
const LS_CLUSTER_TOL = 0.004;
const LS_MIN_TOUCHES = 3;
const LS_PROXIMITY   = 0.03;
const LS_TOP_N       = 10;
const LS_CONCURRENCY = 6;
const LS_MIN_BARS    = 50;

const LS_TF = {
  '15m': { yfInterval: '15m', yfRange: '1mo', resample: 1, label: '15 минут' },
  '1h':  { yfInterval: '60m', yfRange: '3mo', resample: 1, label: '1 час'    },
  '4h':  { yfInterval: '60m', yfRange: '6mo', resample: 4, label: '4 часа'   },
  '1d':  { yfInterval: '1d',  yfRange: '2y',  resample: 1, label: '1 день'   },
};

const LEVELSCAN_UNIVERSE = [
  'NVDA','TSLA','AMD','AAPL','MSFT','META','AMZN','GOOGL','NFLX','AVGO',
  'PLTR','SMCI','COIN','MSTR','MARA','RIOT','SOFI','HOOD','RIVN','LCID',
  'INTC','MU','QCOM','BABA','NIO','F','BAC','DIS','UBER','SHOP',
  'CRWD','SNOW','DDOG','NET','RBLX','PYPL','SQ','ARM','DELL','ORCL'
];

async function lsMapLimit(arr, limit, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: Math.min(limit, arr.length) }, async () => {
    while (i < arr.length) { const idx = i++; out[idx] = await fn(arr[idx]); }
  });
  await Promise.all(workers);
  return out;
}

async function lsFetchBars(symbol, yfInterval, yfRange) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${yfInterval}&range=${yfRange}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) return null;
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  const q = res?.indicators?.quote?.[0];
  const ts = res?.timestamp;
  if (!q || !ts) return null;
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (h == null || l == null || c == null) continue;
    bars.push({ t: ts[i] * 1000, h, l, c });
  }
  return bars.length ? bars : null;
}

function lsResample(bars, factor) {
  if (!factor || factor <= 1) return bars;
  const out = [];
  for (let i = 0; i < bars.length; i += factor) {
    const chunk = bars.slice(i, i + factor);
    if (!chunk.length) continue;
    out.push({
      t: chunk[chunk.length - 1].t,
      h: Math.max(...chunk.map(b => b.h)),
      l: Math.min(...chunk.map(b => b.l)),
      c: chunk[chunk.length - 1].c,
    });
  }
  return out;
}

function lsPivots(bars) {
  const out = [];
  for (let i = LS_PIVOT_K; i < bars.length - LS_PIVOT_K; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - LS_PIVOT_K; j <= i + LS_PIVOT_K; j++) {
      if (j === i) continue;
      if (bars[j].h >= bars[i].h) isHigh = false;
      if (bars[j].l <= bars[i].l) isLow = false;
    }
    if (isHigh) out.push({ price: bars[i].h, t: bars[i].t });
    if (isLow)  out.push({ price: bars[i].l, t: bars[i].t });
  }
  return out;
}

function lsClusterLevels(pvs, now) {
  if (!pvs.length) return [];
  const sorted = [...pvs].sort((a, b) => a.price - b.price);
  const clusters = [];
  let cur = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const base = cur[0].price;
    if ((sorted[i].price - base) / base <= LS_CLUSTER_TOL) cur.push(sorted[i]);
    else { clusters.push(cur); cur = [sorted[i]]; }
  }
  clusters.push(cur);
  return clusters.map(c => {
    const prices = c.map(x => x.price);
    const center = prices.reduce((a, b) => a + b, 0) / prices.length;
    const width  = (Math.max(...prices) - Math.min(...prices)) / center;
    const lastT  = Math.max(...c.map(x => x.t));
    const ageDays = (now - lastT) / 86400000;
    return { center, touches: c.length, width, ageDays };
  }).filter(l => l.touches >= LS_MIN_TOUCHES);
}

function lsScoreLevel(l) {
  const touchScore = Math.min(l.touches, 8) / 8;
  const tightScore = Math.max(0, 1 - l.width / LS_CLUSTER_TOL);
  const freshScore = Math.max(0, 1 - l.ageDays / 60);
  return 0.45 * touchScore + 0.35 * tightScore + 0.20 * freshScore;
}

async function lsScanSymbol(symbol, tf) {
  try {
    let bars = await lsFetchBars(symbol, tf.yfInterval, tf.yfRange);
    if (!bars) return null;
    if (tf.resample > 1) bars = lsResample(bars, tf.resample);
    if (!bars || bars.length < LS_MIN_BARS) return null;
    const price = bars[bars.length - 1].c;
    const now   = bars[bars.length - 1].t;
    const levels = lsClusterLevels(lsPivots(bars), now);
    if (!levels.length) return null;

    const below = levels.filter(l => l.center < price).map(l => ({ ...l, dist: (price - l.center) / price }));
    const above = levels.filter(l => l.center > price).map(l => ({ ...l, dist: (l.center - price) / price }));
    const pickNearest = (arr) => arr.filter(l => l.dist <= LS_PROXIMITY).sort((a, b) => lsScoreLevel(b) - lsScoreLevel(a))[0] || null;

    const support = pickNearest(below);
    const resistance = pickNearest(above);
    if (!support && !resistance) return null;

    const best = [support, resistance].filter(Boolean).sort((a, b) => lsScoreLevel(b) - lsScoreLevel(a))[0];
    const fmt = (l) => l ? {
      level: +l.center.toFixed(2),
      distPct: +(l.dist * 100).toFixed(2),
      touches: l.touches,
      widthPct: +(l.width * 100).toFixed(2),
      ageDays: Math.round(l.ageDays),
      quality: +lsScoreLevel(l).toFixed(2),
    } : null;

    return { symbol, price: +price.toFixed(2), support: fmt(support), resistance: fmt(resistance), rank: +lsScoreLevel(best).toFixed(3) };
  } catch (e) { return null; }
}

async function levelScan(symbols, intervalKey) {
  const key = LS_TF[intervalKey] ? intervalKey : '1h';
  const tf = LS_TF[key];
  const uniq = [...new Set((symbols || []).map(s => String(s).toUpperCase().trim()).filter(Boolean))];
  const scanned = await lsMapLimit(uniq, LS_CONCURRENCY, (s) => lsScanSymbol(s, tf));
  const results = scanned.filter(Boolean).sort((a, b) => b.rank - a.rank).slice(0, LS_TOP_N);
  return { interval: key, timeframe: tf.label, results };
}

async function leadQuote(symbol) {
  try {
    const bars = await lsFetchBars(symbol, '1d', '1mo');
    if (!bars || !bars.length) return null;
    const last = bars[bars.length - 1].c;
    const prev = bars.length > 1 ? bars[bars.length - 2].c : last;
    const changePct = prev ? ((last - prev) / prev) * 100 : 0;
    return { price: +last.toFixed(4), changePct: +changePct.toFixed(2) };
  } catch (e) { return null; }
}

// ====== РЕАЛЬНЫЕ ФУНДАМЕНТАЛЬНЫЕ ЧИСЛА ИЗ FMP (US-тикеры) ======
// Источник истины для цены, 52W, market cap, P/E, EPS. БЕЗ выдумок.
async function fmpQuote(ticker) {
  const key = process.env.FMP_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(ticker)}&apikey=${key}`);
    const arr = await r.json();
    const q = Array.isArray(arr) ? arr[0] : arr;
    if (!q || q.price == null) return null;
    return {
      price: q.price ?? null,
      marketCap: q.marketCap ?? null,
      pe: q.pe ?? null,
      eps: q.eps ?? null,
      yearHigh: q.yearHigh ?? null,
      yearLow: q.yearLow ?? null,
      exchange: q.exchange ?? null
    };
  } catch (e) { return null; }
}

async function fmpDividendYield(ticker) {
  const key = process.env.FMP_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`https://financialmodelingprep.com/stable/ratios-ttm?symbol=${encodeURIComponent(ticker)}&apikey=${key}`);
    const arr = await r.json();
    const x = Array.isArray(arr) ? arr[0] : arr;
    if (!x) return null;
    const dy = x.dividendYieldTTM ?? x.dividendYielTTM ?? x.dividendYield ?? null;
    if (dy == null) return null;
    return dy < 1 ? +(dy * 100).toFixed(2) : +Number(dy).toFixed(2); // нормализуем долю→%
  } catch (e) { return null; }
}

function fmtCap(v) {
  if (v == null) return 'н/д';
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
  if (v >= 1e9)  return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6)  return '$' + (v / 1e6).toFixed(2) + 'M';
  return '$' + v;
}

function rangePosition(price, low, high) {
  if (price == null || low == null || high == null || high <= low) return null;
  return Math.round(((price - low) / (high - low)) * 100); // % от минимума
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, ticker, prompt, query, symbols } = req.body;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const crKey = anthropicKey || process.env.CRAZYROUTER_KEY;
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
    const direct = !!anthropicKey;
    const url = direct ? 'https://api.anthropic.com/v1/messages' : 'https://crazyrouter.com/v1/messages';
    const headers = direct
      ? { 'content-type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' }
      : { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + crKey, 'anthropic-version': '2023-06-01' };
    const who = direct ? 'Anthropic' : 'crazyrouter';
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

  // MOEX: рублёвая цена из текста Tavily (FMP не покрывает MOEX). БЕЗ фабрикации диапазона.
  function extractMoexPrice(text, tickerName) {
    if (!text) return { price: null, high52: null, low52: null };
    const PRICE_RANGES = {
      'RUAL': [15, 150], 'SBER': [150, 500], 'SVCB': [8, 30], 'FLNC': [50, 300],
      'GAZP': [100, 400], 'LKOH': [4000, 10000], 'GMKN': [10000, 25000], 'NVTK': [800, 2000],
    };
    const range = PRICE_RANGES[tickerName] || [1, 100000];
    let price = null, high52 = null, low52 = null;
    const rubPatterns = [
      /(?:₽|руб\.?|RUB)\s*([\d\s]{1,8}[.,]?\d{0,2})/gi,
      /([\d\s]{1,8}[.,]\d{1,2})\s*(?:₽|руб\.?|RUB)/gi,
      /(?:цена|стоимость|котировка|торгуется по|last price|close)[:\s]+([0-9]{2,6}[.,]?[0-9]{0,2})/gi,
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
    const h52 = text.match(/52.{0,10}(?:high|max|макс)[^\d]*([\d]+[.,][\d]*)/i);
    const l52 = text.match(/52.{0,10}(?:low|min|мин)[^\d]*([\d]+[.,][\d]*)/i);
    if (h52) { const v = parseFloat(h52[1].replace(',','.')); if (v >= range[0] && v <= range[1]*1.5) high52 = v; }
    if (l52) { const v = parseFloat(l52[1].replace(',','.')); if (v >= range[0]*0.5 && v <= range[1]) low52 = v; }
    // коррекция явного мусора (цена не может быть вне своего диапазона)
    if (price && high52 && price > high52) high52 = Math.round(price * 1.08 * 100) / 100;
    if (price && low52 && price < low52) low52 = Math.round(price * 0.92 * 100) / 100;
    // НЕТ диапазона в данных → null. НЕ фабрикуем ±30% (это и был источник вранья).
    return { price, high52, low52 };
  }

  // US-фоллбэк, если FMP не ответил. Тоже без фабрикации диапазона.
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
    // НЕТ диапазона → null. Без выдумок.
    return { price, high52, low52 };
  }

  try {
    if (action === 'price') {
      try {
        // US: реальные числа из FMP. Слайдер 52W теперь честный.
        if (!isMoex) {
          const q = await fmpQuote(ticker);
          if (q && q.price != null) {
            return res.json({ price: q.price, high52: q.yearHigh, low52: q.yearLow, currency: 'USD' });
          }
        }
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

    if (action === 'levelscan') {
      const universe = (Array.isArray(symbols) && symbols.length) ? symbols : LEVELSCAN_UNIVERSE;
      const intervalKey = req.body.interval || '1h';
      const scan = await levelScan(universe, intervalKey);
      return res.json({
        action: 'levelscan',
        interval: scan.interval,
        timeframe: scan.timeframe,
        count: scan.results.length,
        results: scan.results
      });
    }

    if (action === 'leading') {
      if (!crKey) return res.status(500).json({ error: 'No API key' });
      const tk = (ticker || '').toUpperCase();
      if (!tk) return res.json({ ticker: '', correlations: [], leading: [] });

      const ctx = await tavilySearch(tk + ' what drives stock price correlations leading indicators commodity supply chain demand 2026');

      const ldPrompt =
        'Ты — STARK AI. Для инструмента ' + tk + ' определи две вещи:\n' +
        '1) С ЧЕМ КОРРЕЛИРУЕТ (сырьё/макро/сектор/валюта) — прямо или обратно.\n' +
        '2) ОПЕРЕЖАЮЩИЕ ИНДИКАТОРЫ — за чем следить, чтобы ПРЕДВИДЕТЬ движение ' + tk + ' (входное сырьё, поставщики, цены, спрос, регуляторика). Эталон: нефтяные компании → WTI/Brent; алюминий → LME aluminum; дата-центры → цена электричества; чипмейкеры → SOX.\n\n' +
        'Для КАЖДОГО коррелята и индикатора дай Yahoo Finance тикер-ПРОКСИ, если торгуемый ориентир существует:\n' +
        '- WTI=CL=F, Brent=BZ=F, золото=GC=F, серебро=SI=F, медь=HG=F, природный газ=NG=F, палладий=PA=F, платина=PL=F\n' +
        '- индекс доллара=DX-Y.NYB, 10Y трежерис=^TNX, S&P500=^GSPC, VIX=^VIX, энергетика ETF=XLE, уран ETF=URA, золотодобыча=GDX, полупроводники=SOXX, биотех=XBI\n' +
        '- отдельные акции/ETF — их обычный тикер; крипта — например BTC-USD, ETH-USD\n' +
        '- если торгуемого прокси НЕТ (напр. "загрузка фабрик") — symbol="".\n\n' +
        'Верни СТРОГО валидный JSON, без markdown и текста вокруг:\n' +
        '{"ticker":"' + tk + '","name":"полное название","summary":"одно предложение: что это и от чего ходит цена",' +
        '"correlations":[{"name":"WTI нефть","symbol":"CL=F","direction":"прямая","note":"механизм одной строкой"}],' +
        '"leading":[{"name":"WTI Crude","symbol":"CL=F","direction":"прямая","mechanism":"как влияет на цену ' + tk + '","lag":"лаг, напр 0-1 нед или 1-2 квартала"}]}\n' +
        'Дай 2-4 коррелята и 3-5 опережающих индикаторов. Числа и факты бери ТОЛЬКО из контекста ниже, не выдумывай.\n\n' +
        '=== КОНТЕКСТ ИЗ ВЕБ-ПОИСКА (2026) ===\n' + (ctx || 'нет данных');

      let obj;
      try {
        const r = await callClaude([{ role: 'user', content: ldPrompt }], 1500);
        const clean = (r || '').replace(/```json|```/g, '').trim();
        const m = clean.match(/\{[\s\S]*\}/);
        obj = m ? JSON.parse(m[0]) : null;
      } catch (e) {
        return res.status(500).json({ error: 'Не удалось разобрать ответ модели — повтори' });
      }
      if (!obj) return res.status(500).json({ error: 'Пустой ответ модели — повтори' });

      const corr = Array.isArray(obj.correlations) ? obj.correlations : [];
      const lead = Array.isArray(obj.leading) ? obj.leading : [];
      const syms = [...new Set([...corr, ...lead].map(x => String(x.symbol || '').trim()).filter(Boolean))];
      const quotes = {};
      await lsMapLimit(syms, LS_CONCURRENCY, async (sym) => { const q = await leadQuote(sym); if (q) quotes[sym] = q; });
      const attach = (x) => {
        const sym = String(x.symbol || '').trim();
        const q = quotes[sym];
        return {
          name: x.name || '', symbol: sym,
          direction: x.direction || '', note: x.note || '', mechanism: x.mechanism || '', lag: x.lag || '',
          price: q ? q.price : null, changePct: q ? q.changePct : null
        };
      };

      return res.json({
        ticker: obj.ticker || tk,
        name: obj.name || '',
        summary: obj.summary || '',
        correlations: corr.map(attach),
        leading: lead.map(attach)
      });
    }

    if (action === 'analyze') {
      if (!crKey) return res.status(500).json({ error: 'No API key' });

      const marketQuery = isMoex
        ? ticker + ' MOEX акция цена рублей котировка 2026'
        : ticker + ' stock price today 2026';

      const corrQuery = ticker + ' suppliers leading indicators correlation 2026';

      const insiderQuery = isMoex
        ? ticker + ' инсайдеры крупный акционер сделки покупка продажа дата 2025 2026 МосБиржа раскрытие'
        : ticker + ' insider transactions Form 4 SEC OpenInsider buy sell date shares 2025 2026';

      const LEADING_INDICATOR_QUERIES = {
        'RUAL': 'aluminum LME price 3M futures today 2026 USD per tonne',
        'FCX':  'copper LME spot price futures 2026 USD per tonne',
        'NEM':  'gold spot price XAU 2026 USD per ounce',
        'GMKN': 'palladium nickel LME price 2026 USD',
        'NLMK': 'steel HRC price European market 2026',
        'CHMF': 'steel billet price Russia export 2026',
        'CEG':  'PJM electricity wholesale price 2026 nuclear power',
        'VST':  'ERCOT Texas electricity spot price 2026',
        'OKLO': 'nuclear energy policy SMR permits USA 2026',
        'UEC':  'uranium spot price UX 2026 USD per pound',
        'CCJ':  'uranium spot price Cameco contract 2026 USD per pound',
        'PBR':  'Brent crude oil price Brazil pre-salt 2026',
        'LKOH': 'Brent crude oil price Urals 2026 USD barrel',
        'ROSN': 'Brent Urals oil price Russia export 2026',
        'NVTK': 'LNG natural gas price Europe TTF 2026',
        'GAZP': 'natural gas price Russia Europe TTF 2026',
        'NOK':  'Nokia 5G contracts revenue telecom infrastructure 2026',
        'RKLB': 'rocket launch market satellite commercial contracts 2026',
        'FLNC': 'battery storage energy grid demand USA 2026',
        'NKE':  'Nike footwear retail sales consumer spending USA 2026',
        'TTWO': 'GTA VI release date Take-Two gaming revenue 2026',
        'SBER': 'ключевая ставка ЦБ РФ 2026 банковский сектор',
        'SVCB': 'Совкомбанк финансовые результаты прибыль 2026',
        'TCSG': 'Т-Банк финансовые результаты клиенты 2026',
        'DEFAULT': ticker + ' suppliers supply chain input cost factory orders leading demand indicator 2026'
      };

      const leadingQuery = LEADING_INDICATOR_QUERIES[ticker.toUpperCase()] || LEADING_INDICATOR_QUERIES['DEFAULT'];

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

      // ИСТОЧНИК ИСТИНЫ: US → FMP (price/52W/mktcap/PE/EPS + дивиденд). MOEX → Tavily-парсинг.
      let fq = null, divY = null;
      if (!isMoex) {
        [fq, divY] = await Promise.all([fmpQuote(ticker), fmpDividendYield(ticker)]);
      }
      const extracted = isMoex
        ? extractMoexPrice(news, (ticker||'').toUpperCase())
        : (fq
            ? { price: fq.price, high52: fq.yearHigh, low52: fq.yearLow }
            : extractUsdPrice(news)); // фоллбэк, если FMP молчит
      const currentPrice = extracted.price;
      const currencySymbol = isMoex ? '₽' : '$';
      const pos = rangePosition(currentPrice, extracted.low52, extracted.high52);

      // Жёсткий блок реальных чисел — ЕДИНСТВЕННЫЙ источник для модели.
      const factsBlock = (!isMoex && fq)
        ? '\n\n=== ТОЧНЫЕ ЧИСЛА (FMP — ЕДИНСТВЕННЫЙ ИСТОЧНИК, НЕ МЕНЯТЬ, НЕ ВЫДУМЫВАТЬ) ===' +
          '\nЦена = $' + fq.price +
          '\nMarket cap = ' + fmtCap(fq.marketCap) +
          '\nP/E = ' + (fq.pe != null ? (+fq.pe).toFixed(2) : 'н/д') +
          '\nEPS = ' + (fq.eps != null ? (+fq.eps).toFixed(2) : 'н/д') +
          '\n52W high = ' + (fq.yearHigh != null ? '$' + fq.yearHigh : 'н/д') +
          '\n52W low = ' + (fq.yearLow != null ? '$' + fq.yearLow : 'н/д') +
          '\nДивиденд (доходность) = ' + (divY != null ? divY + '%' : 'н/д') +
          '\nПозиция в 52W диапазоне = ' + (pos != null ? pos + '% от минимума (0%=у годового дна, 100%=у годового пика)' : 'н/д') +
          '\nЭТО единственный источник для полей price, priceNum, market cap, P/E, EPS, 52W high/low, дивиденда и позиции/ATH. ' +
          'Любое поле "н/д" — оставь "н/д", НЕ подставляй своё число. Запрещено брать цифры из памяти или из текста веб-поиска для этих полей.'
        : '';

      const priceInstruction = currentPrice
        ? '\n\nТекущая цена ' + ticker + ' = ' + currencySymbol + currentPrice +
          (isMoex ? ' (РУБЛИ МОСБИРЖА, из веб-поиска).' : ' (USD).') +
          ' price="' + currencySymbol + currentPrice + '", priceNum=' + currentPrice + '.' +
          (isMoex ? ' ВСЕ цены в РУБЛЯХ ₽. exchange="MOEX".' : '') +
          ' НЕ используй другие числа как цену акции.'
        : '\n\nЦена не подтверждена источником — поле цены оставь "н/д", не выдумывай.';

      const insiderInstruction = '\n\nПОЛЕ insiders: бери ТОЛЬКО реальные сделки из веб-данных (Form 4 / OpenInsider / официальные раскрытия). Для каждой: name, role, type (buy/sell), amount, shares, date — точная дата сделки из Form 4 (формат "15 июн 2026"); если сделка есть в данных, но точной даты нет — укажи хотя бы месяц ("июн 2026"). НЕ показывай сделку, которой НЕТ в веб-данных. Нет подтверждённых сделок с источником — верни []. НИКОГДА не выдумывай инсайдеров, даты, суммы и количество акций.';

      const dateInstruction =
        '\n\n=== СОБЫТИЯ И ДАТЫ (ТОЧНОСТЬ) ===' +
        '\nСегодня 13 июня 2026.' +
        ' В events дай 4-6 событий: недавние подтверждённые факты (прошедшие отчёты/события с реальными датами — это контекст, urgent=false) И будущие катализаторы.' +
        ' Даты в events.date и insiders.date — ТОЛЬКО реальные из веб-данных (формат "15 июн 2026").' +
        ' Если точной даты будущего события в данных нет — напиши "ожидается Q3 2026" и т.п., но НЕ выдумывай конкретное число.' +
        ' urgent=true — только для подтверждённых будущих событий в пределах ~30 дней. Прошедшие события НИКОГДА не помечай urgent.';

      const anticipationInstruction =
        '\n\n=== БЛОК ПРЕДВОСХИЩЕНИЕ — 5 ИНДИКАТОРОВ (ОБЯЗАТЕЛЬНО) ===' +
        '\nПострой причинно-следственную цепочку ВВЕРХ по поставкам для ' + ticker + ':' +
        ' поставщики и их заказы, входное сырьё и его цены, загрузка фабрик/OEM-подрядчиков,' +
        ' законтрактованный пайплайн, опережающие сигналы спроса, регуляторные/тендерные решения.' +
        ' Эталон логики: заказы тайваньских OEM (Feng Tay, Pou Chen) опережают выручку Nike на 1-2 квартала —' +
        ' примени ТАКУЮ ЖЕ логику к ' + ticker + '.' +
        ' Заполни anticipationInd1..anticipationInd5: название индикатора + механизм связи + лаг опережения.' +
        ' ТОЧНОСТЬ: конкретные числа бери ТОЛЬКО из веб-данных ниже; нет числа — опиши механизм качественно, без выдуманных цифр.';

      const leadingNote = leadingData
        ? '\n\n=== ОПЕРЕЖАЮЩИЙ ИНДИКАТОР (РЕАЛЬНЫЕ ДАННЫЕ 2026) ===\n' + leadingData +
          '\nИспользуй эти реальные числа в anticipationInd1..5 где релевантно. НЕ бери данные из памяти.'
        : '';

      const rawData = [
        '=== ЦЕНА И РЫНОК (2026) ===', news || 'нет данных', '',
        '=== ИНСАЙДЕРЫ И МАЖОРИТАРИИ (2025-2026) ===', insiders || 'нет данных', '',
        '=== КАТАЛИЗАТОРЫ И СОБЫТИЯ (2026) ===', catalysts || 'нет данных', '',
        '=== КОРРЕЛЯЦИИ И ПОСТАВЩИКИ ===', correlations || 'нет данных',
        leadingNote
      ].join('\n').trim();

      const analysisPrompt = prompt +
        '\n\nРЕАЛЬНЫЕ ДАННЫЕ ИЗ ВЕБ-ПОИСКА (2026):\n' + rawData +
        factsBlock + priceInstruction + insiderInstruction + anticipationInstruction + dateInstruction +
        '\n\nКРИТИЧНО: Числовые поля (цена, market cap, P/E, EPS, 52W, дивиденд) — ТОЛЬКО из блока ТОЧНЫЕ ЧИСЛА. Остальное — из данных выше. Нет данных → "н/д".' +
        (isMoex ? '\nБИРЖА МОСБИРЖА: цена РУБЛИ (₽). exchange="MOEX".' : '');

      const text = await callClaude([{ role: 'user', content: analysisPrompt }], 5000);
      return res.json({ text });
    }

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

      const STABLE = 'https://financialmodelingprep.com/stable/company-screener?';
      const V3 = 'https://financialmodelingprep.com/api/v3/stock-screener?';
      const tryScreen = async (base) => {
        const r = await fetch(base + params.toString());
        return r.json();
      };

      try {
        let data = await tryScreen(STABLE);
        if (!Array.isArray(data)) {
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
