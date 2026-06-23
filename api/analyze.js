// Vercel: дефолт 10с убивает тяжёлый analyze. 180с даёт медленному crazyrouter время ответить.
// ВАЖНО: значение >60 работает ТОЛЬКО при включённом Fluid Compute (Settings → Functions).
export const config = { maxDuration: 180 };

// ====== LEVEL SCANNER (action 'levelscan') ======
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

// ====== MACRO: снимок индекса с 50/200 DMA, 52W, позицией (action 'macro') ======
async function macroIndexSnapshot(symbol) {
  try {
    const bars = await lsFetchBars(symbol, '1d', '1y');
    if (!bars || bars.length < 50) return null;
    const closes = bars.map(b => b.c);
    const price = closes[closes.length - 1];
    const prev  = closes.length > 1 ? closes[closes.length - 2] : price;
    const changePct = prev ? +(((price - prev) / prev) * 100).toFixed(2) : null;
    const sma = (n) => { if (closes.length < n) return null; const s = closes.slice(-n); return +(s.reduce((a, b) => a + b, 0) / n).toFixed(2); };
    const sma50  = sma(50);
    const sma200 = sma(200);
    const high52 = +Math.max(...bars.map(b => b.h)).toFixed(2);
    const low52  = +Math.min(...bars.map(b => b.l)).toFixed(2);
    const fromHighPct = high52 ? +(((price / high52) - 1) * 100).toFixed(2) : null;
    const pos = (high52 > low52) ? Math.round(((price - low52) / (high52 - low52)) * 100) : null;
    return {
      symbol, price: +price.toFixed(2), changePct, sma50, sma200, high52, low52, fromHighPct, pos,
      above50:  sma50  != null ? price > sma50  : null,
      above200: sma200 != null ? price > sma200 : null,
    };
  } catch (e) { return null; }
}

// ====== ЦЕНА + 52W ИЗ YAHOO META (US, надёжно, бесплатно, проходит из Vercel) ======
async function yahooQuote(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const j = await r.json();
    const m = j?.chart?.result?.[0]?.meta;
    if (!m || m.regularMarketPrice == null) return null;
    const price = m.regularMarketPrice;
    const yearHigh = m.fiftyTwoWeekHigh ?? null;
    const prevClose = m.chartPreviousClose ?? m.previousClose ?? null;
    const changePct = (prevClose != null && prevClose !== 0) ? +(((price - prevClose) / prevClose) * 100).toFixed(2) : null;
    const atHighPct = (yearHigh != null && yearHigh !== 0) ? +(((price / yearHigh) - 1) * 100).toFixed(1) : null;
    return {
      price:    price,
      yearHigh: yearHigh,
      yearLow:  m.fiftyTwoWeekLow ?? null,
      changePct: changePct,
      atHighPct: atHighPct
    };
  } catch (e) { return null; }
}

// ====== ФУНДАМЕНТАЛ ИЗ FMP (market cap надёжен; pe/52W на free-плане часто пустые) ======
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
      yearLow: q.yearLow ?? null
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
    return dy < 1 ? +(dy * 100).toFixed(2) : +Number(dy).toFixed(2);
  } catch (e) { return null; }
}

// ====== MOEX ISS — официальный источник по российским акциям (бесплатно, без ключа) ======
async function moexQuote(ticker) {
  try {
    // boards/TQBR — основной режим торгов акциями. Без этого ISS отдаёт первую попавшуюся
    // строку (может прилететь неликвидный борд с искажённой ценой).
    const u1 = `https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/${encodeURIComponent(ticker)}.json`
      + `?iss.meta=off&iss.only=securities,marketdata`
      + `&securities.columns=SECID,PREVPRICE,ISSUECAPITALIZATION,ISSUESIZE`
      + `&marketdata.columns=SECID,LAST,LASTTOPREVPRICE,MARKETPRICE`;
    const r1 = await fetch(u1);
    const j1 = await r1.json();
    const sec = j1?.securities?.data?.[0] || [];
    const md  = j1?.marketdata?.data?.[0] || [];
    const prevPrice = sec[1] ?? null;
    let cap = sec[2] ?? null;
    const issueSize = sec[3] ?? null;
    // приоритет: LAST (последняя сделка) → MARKETPRICE (рыночная) → PREVPRICE (закрытие пред. дня)
    const last = (md[1] != null) ? md[1] : (md[3] != null ? md[3] : prevPrice);
    if (last == null) return null;
    if ((cap == null || cap === 0) && issueSize != null) cap = last * issueSize;
    // дневное изменение: LASTTOPREVPRICE (md[2]) — официальный % ISS; в выходной торгов нет → null
    let changePct = (md[2] != null) ? +Number(md[2]).toFixed(2)
                   : (prevPrice && md[1] != null && prevPrice !== 0) ? +(((md[1] - prevPrice) / prevPrice) * 100).toFixed(2)
                   : null;

    // 52W из месячных свечей за год (interval=31 = месяц) — один запрос, борд TQBR
    let yearHigh = null, yearLow = null;
    try {
      const to = new Date(), from = new Date(); from.setFullYear(from.getFullYear() - 1);
      const fs = from.toISOString().slice(0, 10), ts = to.toISOString().slice(0, 10);
      const u2 = `https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/${encodeURIComponent(ticker)}/candles.json`
        + `?from=${fs}&till=${ts}&interval=31&iss.meta=off&iss.only=candles&candles.columns=high,low`;
      const r2 = await fetch(u2);
      const j2 = await r2.json();
      for (const row of (j2?.candles?.data || [])) {
        const h = row[0], l = row[1];
        if (h != null) yearHigh = yearHigh == null ? h : Math.max(yearHigh, h);
        if (l != null) yearLow  = yearLow  == null ? l : Math.min(yearLow, l);
      }
    } catch (e) {}

    const atHighPct = (yearHigh != null && yearHigh !== 0) ? +(((last / yearHigh) - 1) * 100).toFixed(1) : null;
    return { price: last, marketCap: cap, yearHigh, yearLow, changePct, atHighPct };
  } catch (e) { return null; }
}

async function moexDividends(ticker) {
  try {
    const r = await fetch(`https://iss.moex.com/iss/securities/${encodeURIComponent(ticker)}/dividends.json?iss.meta=off`);
    const j = await r.json();
    const cols = j?.dividends?.columns || [];
    const rows = j?.dividends?.data || [];
    const iVal = cols.indexOf('value');
    const iDate = cols.indexOf('registryclosedate');
    if (iVal < 0 || !rows.length) return null;
    const yearAgo = new Date(); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    let ttm = 0, found = false;
    for (const row of rows) {
      const v = row[iVal];
      const d = iDate >= 0 && row[iDate] ? new Date(row[iDate]) : null;
      if (v != null && (!d || d >= yearAgo)) { ttm += Number(v); found = true; }
    }
    return found ? ttm : null; // сумма дивидендов на акцию за 12 мес
  } catch (e) { return null; }
}

function fmtCap(v) {
  if (v == null) return 'н/д';
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
  if (v >= 1e9)  return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6)  return '$' + (v / 1e6).toFixed(2) + 'M';
  return '$' + v;
}

function fmtCapCur(v, moex) {
  if (v == null) return 'н/д';
  if (moex) {
    if (v >= 1e9) return (v / 1e9).toFixed(0) + ' млрд ₽';
    if (v >= 1e6) return (v / 1e6).toFixed(0) + ' млн ₽';
    return Math.round(v) + ' ₽';
  }
  return fmtCap(v);
}

function rangePosition(price, low, high) {
  if (price == null || low == null || high == null || high <= low) return null;
  return Math.round(((price - low) / (high - low)) * 100);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, ticker, prompt, query, symbols } = req.body;
  // === ПРОВАЙДЕРЫ МОДЕЛИ (failover) ===
  // crazyrouter — primary, OpenRouter — fallback, Anthropic — если появится прямой ключ.
  const anthropicKey   = process.env.ANTHROPIC_API_KEY;
  const crazyrouterKey = process.env.CRAZYROUTER_KEY;
  const openrouterKey  = process.env.OPENROUTER_KEY;
  const hasModelProvider = !!(crazyrouterKey || openrouterKey || anthropicKey);
  const tvKey = process.env.TAVILY_KEY;
  const fmpKey = process.env.FMP_KEY;

  const MOEX_TICKERS = ['SBER','SVCB','RUAL','FLNC','LKOH','GAZP','YNDX','NVTK','ROSN','GMKN','MTSS','VTBR','AFLT','POLY','PLZL','MGNT','ALRS','PHOR','NLMK','CHMF','MAGN','RTKM','FEES','HYDR','IRAO','MOEX','TCSG','OZON','VKCO'];
  const isMoex = MOEX_TICKERS.includes((ticker || '').toUpperCase());

  // opts (необязательно): { days: N — свежесть в днях (включает topic:news), depth:'advanced', max:N }
  // Без opts ведёт себя как раньше — другие action'ы не ломаются.
  async function tavilySearch(q, opts) {
    if (!tvKey) return '';
    opts = opts || {};
    try {
      const body = {
        api_key: tvKey,
        query: q,
        search_depth: opts.depth || 'basic',
        max_results: opts.max || 5,
        include_answer: true,
      };
      // Окно свежести: переключаем в новостной режим, чтобы тянуть именно последние материалы.
      if (opts.days) { body.topic = 'news'; body.days = opts.days; }
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await r.json();
      return data.answer || (data.results || []).map(x => x.title + ': ' + x.content).join('\n\n');
    } catch (e) { return ''; }
  }

  // === callClaude с автоматическим перебором провайдеров ===
  // Идём по списку: первый рабочий ответ возвращаем. На 502/HTML/таймаут/ошибку — следующий.
  // Общий дедлайн 175с (< maxDuration=180), чтобы успеть к fallback, а не сгореть на первом.
  async function callClaude(messages, maxTokens) {
    maxTokens = maxTokens || 4000;

    const providers = [
      crazyrouterKey && {
        who: 'crazyrouter',
        url: 'https://crazyrouter.com/v1/messages',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + crazyrouterKey, 'anthropic-version': '2023-06-01' },
        model: 'claude-sonnet-4-5',
      },
      openrouterKey && {
        who: 'OpenRouter',
        url: 'https://openrouter.ai/api/v1/messages',
        headers: { 'Content-Type': 'application/json', 'x-api-key': openrouterKey, 'anthropic-version': '2023-06-01' },
        model: 'anthropic/claude-sonnet-4.5',
      },
      anthropicKey && {
        who: 'Anthropic',
        url: 'https://api.anthropic.com/v1/messages',
        headers: { 'content-type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
        model: 'claude-sonnet-4-5',
      },
    ].filter(Boolean);

    if (!providers.length) throw new Error('Не задан ни один ключ модели (CRAZYROUTER_KEY / OPENROUTER_KEY / ANTHROPIC_API_KEY)');

    const HARD_DEADLINE = Date.now() + 175000;
    let lastErr = '';

    for (let i = 0; i < providers.length; i++) {
      const p = providers[i];
      const isLast = i === providers.length - 1;
      const remaining = HARD_DEADLINE - Date.now();
      if (remaining < 8000) { lastErr = 'исчерпан бюджет времени функции (' + lastErr + ')'; break; }
      // не-последнему даём максимум 110с, чтобы остался запас на fallback
      const budget = isLast ? remaining : Math.min(remaining, 110000);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), budget);
      try {
        const r = await fetch(p.url, {
          method: 'POST',
          headers: p.headers,
          body: JSON.stringify({ model: p.model, max_tokens: maxTokens, messages }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        const raw = await r.text();

        // Прокси при сбое (502/503) отдают HTML-страницу вместо JSON — ловим ДО JSON.parse.
        if (!r.ok || raw.trim().startsWith('<')) {
          lastErr = p.who + ' HTTP ' + r.status + ': ' + raw.slice(0, 120).replace(/\s+/g, ' ').trim();
          continue;
        }

        let d;
        try { d = JSON.parse(raw); }
        catch { lastErr = p.who + ' вернул не-JSON (HTTP ' + r.status + ')'; continue; }

        if (d.error) { lastErr = (d.error.message || JSON.stringify(d.error)) + ' [' + p.who + ']'; continue; }

        const out = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
        if (out) return out; // успех — выходим
        lastErr = p.who + ' вернул пустой ответ';
      } catch (e) {
        clearTimeout(timer);
        lastErr = (e && e.name === 'AbortError')
          ? p.who + ' прерван по таймауту (' + Math.round(budget / 1000) + 'с)'
          : p.who + ' недоступен: ' + (e?.message || String(e));
      }
    }

    throw new Error('Все провайдеры модели недоступны → ' + lastErr);
  }

  // MOEX: фоллбэк-парсинг из текста Tavily (если ISS недоступен). БЕЗ фабрикации диапазона.
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
    if (h52) { const v = parseFloat(h52[1].replace(',', '.')); if (v >= range[0] && v <= range[1] * 1.5) high52 = v; }
    if (l52) { const v = parseFloat(l52[1].replace(',', '.')); if (v >= range[0] * 0.5 && v <= range[1]) low52 = v; }
    if (price && high52 && price > high52) high52 = Math.round(price * 1.08 * 100) / 100;
    if (price && low52 && price < low52) low52 = Math.round(price * 0.92 * 100) / 100;
    // нет диапазона в тексте → null, без фабрикации ±%
    return { price, high52, low52 };
  }

  // US-фоллбэк, если Yahoo и FMP молчат. Тоже без фабрикации диапазона.
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
    return { price, high52, low52 };
  }

  try {
    if (action === 'price') {
      try {
        if (isMoex) {
          const mq = await moexQuote(ticker);
          if (mq && mq.price != null) {
            return res.json({ price: mq.price, high52: mq.yearHigh, low52: mq.yearLow, changePct: mq.changePct, atHighPct: mq.atHighPct, currency: 'RUB' });
          }
          // ISS не ответил (вероятно блок дата-центра): честное н/д, без выдёргивания мусора из новостей
          return res.json({ price: null, currency: 'RUB', note: 'ISS unreachable' });
        } else {
          const yq = await yahooQuote(ticker);
          if (yq && yq.price != null) return res.json({ price: yq.price, high52: yq.yearHigh, low52: yq.yearLow, changePct: yq.changePct, atHighPct: yq.atHighPct, currency: 'USD' });
          const q = await fmpQuote(ticker);
          if (q && q.price != null) return res.json({ price: q.price, high52: q.yearHigh, low52: q.yearLow, currency: 'USD' });
          const priceData = await tavilySearch(ticker + ' stock price today 2026');
          const extracted = extractUsdPrice(priceData);
          return res.json({ price: extracted.price, high52: extracted.high52, low52: extracted.low52, currency: 'USD' });
        }
      } catch (e) {}
      return res.json({ price: null });
    }

    if (action === 'search') {
      const result = await tavilySearch(query || '');
      return res.json({ result });
    }

    if (action === 'resolve') {
      const raw = (ticker || '').trim();
      if (!raw) return res.json({ ticker: '', name: '' });
      if (!hasModelProvider) return res.json({ ticker: raw.toUpperCase(), name: '' });
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
      return res.json({ action: 'levelscan', interval: scan.interval, timeframe: scan.timeframe, count: scan.results.length, results: scan.results });
    }

    if (action === 'leading') {
      if (!hasModelProvider) return res.status(500).json({ error: 'No API key' });
      const tk = (ticker || '').toUpperCase();
      if (!tk) return res.json({ ticker: '', correlations: [], leading: [] });

      const ctx = await tavilySearch(tk + ' what drives stock price correlations leading indicators commodity supply chain demand 2026');

      const ldPrompt =
        'Ты — STARK AI. Для инструмента ' + tk + ' определи две вещи:\n' +
        '1) С ЧЕМ КОРРЕЛИРУЕТ (сырьё/макро/сектор/валюта) — прямо или обратно.\n' +
        '2) ОПЕРЕЖАЮЩИЕ ИНДИКАТОРЫ — за чем следить, чтобы ПРЕДВИДЕТЬ движение ' + tk + '. Эталон: нефтяные компании → WTI/Brent; алюминий → LME aluminum; дата-центры → цена электричества; чипмейкеры → SOX.\n\n' +
        'Для КАЖДОГО коррелята и индикатора дай Yahoo Finance тикер-ПРОКСИ, если торгуемый ориентир существует:\n' +
        '- WTI=CL=F, Brent=BZ=F, золото=GC=F, серебро=SI=F, медь=HG=F, природный газ=NG=F, палладий=PA=F, платина=PL=F\n' +
        '- индекс доллара=DX-Y.NYB, 10Y трежерис=^TNX, S&P500=^GSPC, VIX=^VIX, энергетика ETF=XLE, уран ETF=URA, золотодобыча=GDX, полупроводники=SOXX, биотех=XBI\n' +
        '- отдельные акции/ETF — их обычный тикер; крипта — например BTC-USD, ETH-USD\n' +
        '- если торгуемого прокси НЕТ — symbol="".\n\n' +
        'Верни СТРОГО валидный JSON, без markdown:\n' +
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
        return { name: x.name || '', symbol: sym, direction: x.direction || '', note: x.note || '', mechanism: x.mechanism || '', lag: x.lag || '', price: q ? q.price : null, changePct: q ? q.changePct : null };
      };

      return res.json({ ticker: obj.ticker || tk, name: obj.name || '', summary: obj.summary || '', correlations: corr.map(attach), leading: lead.map(attach) });
    }

    // ====== ГЛОБАЛЬНЫЙ ОБЗОР РЫНКА (action 'macro') ======
    // Числа (индексы, MA, 52W, цены активов, секторная ротация) — ДЕТЕРМИНИРОВАННО с Yahoo.
    // Claude поверх даёт ТОЛЬКО аналитику из Tavily: режим, ширина, предвосхищение, инсайд, вердикт.
    if (action === 'macro') {
      if (!hasModelProvider) return res.status(500).json({ error: 'No API key' });

      const ASSET_DEFS = [
        { name: 'Золото',           symbol: 'GC=F',      unit: '$'   },
        { name: 'WTI нефть',        symbol: 'CL=F',      unit: '$'   },
        { name: '10Y трежерис',     symbol: '^TNX',      unit: '%'   },
        { name: 'Индекс доллара',   symbol: 'DX-Y.NYB',  unit: 'idx' },
        { name: 'Bitcoin',          symbol: 'BTC-USD',   unit: 'big' },
        { name: 'Медь',             symbol: 'HG=F',      unit: '$'   },
        { name: 'Серебро',          symbol: 'SI=F',      unit: '$'   },
      ];
      const SECTOR_DEFS = [
        { name: 'Технологии',       symbol: 'XLK', kind: 'cyc' },
        { name: 'Финансы',          symbol: 'XLF', kind: 'cyc' },
        { name: 'Энергетика',       symbol: 'XLE', kind: 'cyc' },
        { name: 'Здравоохранение',  symbol: 'XLV', kind: 'def' },
        { name: 'Потреб. цикл.',    symbol: 'XLY', kind: 'cyc' },
        { name: 'Потреб. защита',   symbol: 'XLP', kind: 'def' },
        { name: 'Промышленность',   symbol: 'XLI', kind: 'cyc' },
        { name: 'Коммуналка',       symbol: 'XLU', kind: 'def' },
      ];

      // === ОСОЗНАНИЕ ДАТЫ И ДНЯ НЕДЕЛИ (МСК) — каждый запрос привязан к реальному «сейчас» ===
      const tz = 'Europe/Moscow';
      const nowD = new Date();
      const today = nowD.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: tz });
      const weekdayRu = nowD.toLocaleDateString('ru-RU', { weekday: 'long', timeZone: tz });
      const dowShort = nowD.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz });
      const dowMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
      const dow = dowMap[dowShort] || 1;
      const daysToFriday = Math.max(0, 5 - dow);
      const weekPhase = dow <= 1 ? 'начало недели' : (dow <= 3 ? 'середина недели' : (dow <= 5 ? 'конец недели' : 'выходные (рынок США закрыт)'));
      const ymd = nowD.toLocaleDateString('en-CA', { timeZone: tz });               // YYYY-MM-DD
      const monthYear = nowD.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: tz });
      // Свежесть новостных запросов: в начале недели заглядываем чуть глубже (захватить выходные/понедельник).
      const FRESH = (dow <= 1 || dow >= 6) ? 4 : 3;

      // 10 параллельных Tavily-запросов — отдельный по каждому классу активов (режим «максимум»).
      // topic:news + окно дней → каждый клик подтягивает именно сегодняшние материалы, а не кэш.
      const Q = (s) => s + ' ' + monthYear;  // привязка к реальному месяцу/году
      const [
        spx, ndx, rut, vixQ, assetQs, sectorQs,
        news, flows, rotation, commod, oil, ratesFx, crypto, eurasia, calendar, insiderCtx
      ] = await Promise.all([
        macroIndexSnapshot('^GSPC'),
        macroIndexSnapshot('^IXIC'),
        macroIndexSnapshot('^RUT'),
        leadQuote('^VIX'),
        Promise.all(ASSET_DEFS.map(a => leadQuote(a.symbol))),
        Promise.all(SECTOR_DEFS.map(s => leadQuote(s.symbol))),
        tavilySearch(Q('US stock market today S&P 500 Nasdaq outlook sentiment overbought oversold breadth'), { days: FRESH, max: 6 }),
        tavilySearch(Q('institutional fund flows month-end quarter-end rebalancing pension fund forced selling buying billions'), { days: FRESH, max: 6 }),
        tavilySearch(Q('stock market sector rotation today leaders laggards tech consumer staples money flow'), { days: FRESH, max: 5 }),
        tavilySearch(Q('gold silver copper price outlook forecast direction safe haven demand today'), { days: FRESH, max: 5 }),
        tavilySearch(Q('WTI crude oil price brent OPEC supply demand outlook today'), { days: FRESH, max: 4 }),
        tavilySearch(Q('US 10 year treasury yield dollar index DXY Fed rate path direction today'), { days: FRESH, max: 5 }),
        tavilySearch(Q('Bitcoin Ethereum crypto market today risk sentiment ETF flows'), { days: FRESH, max: 5 }),
        tavilySearch(Q('European Asian stock markets today DAX Nikkei Hang Seng global risk'), { days: FRESH, max: 5 }),
        tavilySearch(Q('US economic calendar this week Fed FOMC CPI PCE jobs report earnings OPEX options expiration'), { days: 7, max: 6 }),
        tavilySearch(Q('notable insider buying CEO CFO purchase institutional 13F large position latest'), { days: 14, max: 5 }),
      ]);

      const assets = ASSET_DEFS.map((a, i) => ({
        name: a.name, symbol: a.symbol, unit: a.unit,
        price: assetQs[i] ? assetQs[i].price : null,
        changePct: assetQs[i] ? assetQs[i].changePct : null,
      }));

      const sectors = SECTOR_DEFS.map((s, i) => ({
        name: s.name, symbol: s.symbol, kind: s.kind,
        changePct: sectorQs[i] ? sectorQs[i].changePct : null,
      })).filter(s => s.changePct != null).sort((a, b) => b.changePct - a.changePct);

      const vix = vixQ ? vixQ.price : null;

      // Детерминированная подсказка режима по циклика-vs-защита (для контекста модели)
      const cycAvg = (() => { const a = sectors.filter(s => s.kind === 'cyc'); return a.length ? a.reduce((x, y) => x + y.changePct, 0) / a.length : null; })();
      const defAvg = (() => { const a = sectors.filter(s => s.kind === 'def'); return a.length ? a.reduce((x, y) => x + y.changePct, 0) / a.length : null; })();

      const idxLine = (label, s) => s ? (
        label + ': ' + s.price + ' (день ' + (s.changePct >= 0 ? '+' : '') + s.changePct + '%), ' +
        '50DMA ' + (s.sma50 ?? 'н/д') + ' → цена ' + (s.above50 == null ? 'н/д' : s.above50 ? 'ВЫШЕ' : 'НИЖЕ') + '; ' +
        '200DMA ' + (s.sma200 ?? 'н/д') + ' → цена ' + (s.above200 == null ? 'н/д' : s.above200 ? 'ВЫШЕ' : 'НИЖЕ') + '; ' +
        'от 52W-хая ' + (s.fromHighPct != null ? s.fromHighPct + '%' : 'н/д') + '; позиция в 52W ' + (s.pos != null ? s.pos + '%' : 'н/д')
      ) : (label + ': н/д');

      const assetsLine = assets.map(a => a.name + ' (' + a.symbol + ') = ' + (a.price != null ? a.price : 'н/д') + (a.changePct != null ? ' (' + (a.changePct >= 0 ? '+' : '') + a.changePct + '%)' : '')).join('\n');
      const sectorsLine = sectors.map(s => s.name + ' (' + s.symbol + '): ' + (s.changePct >= 0 ? '+' : '') + s.changePct + '%').join('\n');

      const factsBlock =
        '=== ТОЧНЫЕ ЧИСЛА РЫНКА (Yahoo, ' + today + ', ' + weekdayRu + ' — ЕДИНСТВЕННЫЙ ИСТОЧНИК ЦИФР, НЕ ВЫДУМЫВАТЬ) ===\n' +
        idxLine('S&P 500 (^GSPC)', spx) + '\n' +
        idxLine('NASDAQ Comp (^IXIC)', ndx) + '\n' +
        idxLine('Russell 2000 (^RUT) — малые компании, барометр аппетита к риску', rut) + '\n' +
        'VIX (^VIX) = ' + (vix != null ? vix : 'н/д') + (vixQ && vixQ.changePct != null ? ' (' + (vixQ.changePct >= 0 ? '+' : '') + vixQ.changePct + '%)' : '') + '\n\n' +
        'АКТИВЫ:\n' + assetsLine + '\n\n' +
        'СЕКТОРНАЯ РОТАЦИЯ (дневное изменение SPDR-секторов, отсортировано):\n' + sectorsLine + '\n' +
        'Среднее циклических (XLK/XLF/XLE/XLY/XLI) = ' + (cycAvg != null ? (cycAvg >= 0 ? '+' : '') + cycAvg.toFixed(2) + '%' : 'н/д') +
        '; среднее защитных (XLV/XLP/XLU) = ' + (defAvg != null ? (defAvg >= 0 ? '+' : '') + defAvg.toFixed(2) + '%' : 'н/д');

      const macroPrompt =
        'Ты — STARK AI, рыночный аналитик Алексея. Дай ГЛОБАЛЬНЫЙ обзор рынка на сегодня.\n' +
        'СЕГОДНЯ: ' + today + ', ' + weekdayRu + '. Сейчас ' + weekPhase + '. До конца торговой недели (пятница) осталось дней: ' + daysToFriday + '.\n' +
        'Пиши ПРОСТО и ясно — так, чтобы понял даже новичок: короткие фразы, без жаргона без расшифровки. Но по сути — как опытный трейдер.\n' +
        'Все числовые факты (уровни индексов, MA, %, цены активов, проценты секторов) бери ТОЛЬКО из блока ТОЧНЫЕ ЧИСЛА ниже — они посчитаны по живым данным Yahoo. НЕ выдумывай и НЕ меняй их.\n' +
        'Текстовую аналитику строй ТОЛЬКО на контексте веб-поиска ниже (он свежий, за последние дни). Нет факта/числа в данных — формулируй качественно, без выдуманной цифры. Даты — только реальные из веб-поиска; нет точной — пиши "ожидается".\n' +
        'anticipation: реальные ТЕКУЩИЕ потоки и катализаторы — month-/quarter-end ребалансировки (пример: «фонды должны продать ~$X к концу месяца»), OPEX/quad witching, ФРС, CPI/PCE/jobs, крупные корп. события. Каждый пункт — с датой и тегом.\n' +
        'weeklyOutlook: что важного выходит ПО ДНЯМ до конца этой недели (используй [КАЛЕНДАРЬ]) и общий вектор до пятницы.\n' +
        'playbook: конкретный план по секторам/классам активов в стиле Алексея — глагол + причина. Пример мышления: «технологии — покупать на откатах к поддержке», «потребительский защитный сектор — распродавать в силу», «золото — держать как страховку». Опирайся на ротацию (циклика vs защита) и веб-контекст.\n\n' +
        'Верни СТРОГО валидный JSON без markdown, без текста вокруг:\n' +
        '{\n' +
        '  "regime": "RISK-ON" | "RISK-OFF" | "СМЕШАННЫЙ",\n' +
        '  "regimeLine": "одно ёмкое предложение простым языком: какой сейчас режим и почему",\n' +
        '  "weekToday": "одно предложение: какой сегодня день недели и где мы в торговой неделе",\n' +
        '  "marketState": "ПЕРЕКУПЛЕН" | "ПЕРЕПРОДАН" | "НЕЙТРАЛЕН",\n' +
        '  "stateNote": "1-2 простых предложения: где S&P относительно хаёв/MA, что говорит VIX",\n' +
        '  "breadth": "1-2 предложения о ширине рынка простыми словами: узкое ли ралли, кто тянет (подсказка: сравни Russell 2000 с S&P)",\n' +
        '  "sectorNote": "1-2 предложения: куда идут деньги, в риск (циклика) или в оборону (защита)",\n' +
        '  "goldNote": "1 предложение: куда смотрит золото и почему",\n' +
        '  "anticipation": [ {"title":"кратко","detail":"механизм/суть и влияние на рынок простыми словами","date":"дата или ожидается","tag":"flow"} ],\n' +
        '  "weeklyOutlook": "2-4 предложения: чего ждать до конца недели, ключевые события по дням, общий вектор",\n' +
        '  "playbook": [ {"asset":"Технологии","action":"BUY_DIP","note":"коротко почему"} ],\n' +
        '  "insiders": [ {"name":"кто","role":"должность/фонд","detail":"что сделал","date":"дата","type":"buy"} ],\n' +
        '  "bullCase": "2-3 простых предложения за рост",\n' +
        '  "bearCase": "2-3 простых предложения за падение/риск",\n' +
        '  "verdict": "2-3 предложения: чистая позиция STARK по рынку сейчас, простым языком",\n' +
        '  "stance": "RISK-ON" | "НЕЙТРАЛЬНО" | "DEFENSE"\n' +
        '}\n' +
        'tag в anticipation — одно из: "flow" (поток/ребаланс), "catalyst" (событие/отчёт), "risk" (риск-фактор). ' +
        'action в playbook — СТРОГО одно из: "BUY_DIP" (покупать на откатах), "BUY" (покупать в силу), "HOLD" (держать), "DISTRIBUTE" (распродавать/фиксировать), "AVOID" (избегать/шортить). ' +
        'type в insiders — "buy" или "sell". ' +
        'anticipation — 3-6 пунктов. playbook — 4-7 пунктов (секторы и/или классы активов: акции/золото/нефть/крипта). insiders — 0-5 реальных (нет подтверждённых — пустой массив, НЕ выдумывай). bull/bear обязательны оба.\n\n' +
        factsBlock + '\n\n' +
        '=== КОНТЕКСТ ВЕБ-ПОИСКА (свежий, ' + monthYear + ') ===\n' +
        '[РЫНОК/НАСТРОЕНИЕ]\n' + (news || 'нет данных') + '\n\n' +
        '[ПОТОКИ ФОНДОВ]\n' + (flows || 'нет данных') + '\n\n' +
        '[СЕКТОРНАЯ РОТАЦИЯ]\n' + (rotation || 'нет данных') + '\n\n' +
        '[СЫРЬЁ: ЗОЛОТО/СЕРЕБРО/МЕДЬ]\n' + (commod || 'нет данных') + '\n\n' +
        '[НЕФТЬ]\n' + (oil || 'нет данных') + '\n\n' +
        '[СТАВКИ И ДОЛЛАР]\n' + (ratesFx || 'нет данных') + '\n\n' +
        '[КРИПТА]\n' + (crypto || 'нет данных') + '\n\n' +
        '[ЕВРОПА/АЗИЯ]\n' + (eurasia || 'нет данных') + '\n\n' +
        '[КАЛЕНДАРЬ/КАТАЛИЗАТОРЫ НЕДЕЛИ]\n' + (calendar || 'нет данных') + '\n\n' +
        '[ИНСАЙД/ИНСТИТУЦИОНАЛЫ]\n' + (insiderCtx || 'нет данных');

      let ai = null;
      try {
        const r = await callClaude([{ role: 'user', content: macroPrompt }], 4800);
        const clean = (r || '').replace(/```json|```/g, '').trim();
        const m = clean.match(/\{[\s\S]*\}/);
        ai = m ? JSON.parse(m[0]) : null;
      } catch (e) {
        return res.status(500).json({ error: 'Модель не ответила по обзору — повтори. (' + (e.message || e) + ')' });
      }
      if (!ai) return res.status(500).json({ error: 'Пустой/битый ответ модели по обзору — повтори' });

      return res.json({
        asOf: today,
        weekday: weekdayRu,
        weekPhase,
        daysToFriday,
        indices: { spx, ndx, rut, vix, vixChange: vixQ ? vixQ.changePct : null },
        assets,
        sectors,
        cycAvg: cycAvg != null ? +cycAvg.toFixed(2) : null,
        defAvg: defAvg != null ? +defAvg.toFixed(2) : null,
        ai,
      });
    }

    if (action === 'analyze') {
      if (!hasModelProvider) return res.status(500).json({ error: 'No API key' });

      const marketQuery = isMoex ? ticker + ' MOEX акция цена рублей котировка 2026' : ticker + ' stock price today 2026';
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
        tavilySearch(marketQuery), tavilySearch(insiderQuery), tavilySearch(catalystQuery), tavilySearch(corrQuery), tavilySearch(leadingQuery)
      ]);

      const news         = results[0].status === 'fulfilled' ? results[0].value : '';
      const insiders     = results[1].status === 'fulfilled' ? results[1].value : '';
      const catalysts    = results[2].status === 'fulfilled' ? results[2].value : '';
      const correlations = results[3].status === 'fulfilled' ? results[3].value : '';
      const leadingData  = results[4] && results[4].status === 'fulfilled' ? results[4].value : '';

      // ИСТОЧНИКИ ИСТИНЫ: US → Yahoo(цена,52W)+FMP(капа,PE,EPS,дивиденд). MOEX → ISS(цена,капа,52W,дивиденды).
      let fq = null, yq = null, mq = null;
      let px = null, yH = null, yL = null, cap = null, peVal = null, epsVal = null, divY = null;

      if (isMoex) {
        let mDiv = null;
        [mq, mDiv] = await Promise.all([moexQuote(ticker), moexDividends(ticker)]);
        const ex = extractMoexPrice(news, (ticker || '').toUpperCase()); // фоллбэк, если ISS недоступен
        px  = (mq && mq.price != null) ? mq.price : ex.price;
        yH  = (mq && mq.yearHigh != null) ? mq.yearHigh : ex.high52;
        yL  = (mq && mq.yearLow != null) ? mq.yearLow : ex.low52;
        cap = mq ? mq.marketCap : null;
        divY = (mDiv != null && px) ? +(mDiv / px * 100).toFixed(2) : null;
        // P/E по MOEX нет надёжного API → н/д (не выдумываем)
      } else {
        [fq, yq, divY] = await Promise.all([fmpQuote(ticker), yahooQuote(ticker), fmpDividendYield(ticker)]);
        px  = (yq && yq.price != null) ? yq.price : (fq ? fq.price : null);
        yH  = (yq && yq.yearHigh != null) ? yq.yearHigh : (fq ? fq.yearHigh : null);
        yL  = (yq && yq.yearLow != null) ? yq.yearLow : (fq ? fq.yearLow : null);
        cap = fq ? fq.marketCap : null;
        peVal = fq ? fq.pe : null;
        epsVal = fq ? fq.eps : null;
      }

      const extracted = { price: px, high52: yH, low52: yL };
      const currentPrice = px;
      const currencySymbol = isMoex ? '₽' : '$';
      const pos = rangePosition(px, yL, yH);

      const factsBlock = (px != null || cap != null)
        ? '\n\n=== ТОЧНЫЕ ЧИСЛА (' + (isMoex ? 'MOEX ISS' : 'Yahoo+FMP') + ' — ЕДИНСТВЕННЫЙ ИСТОЧНИК, НЕ ВЫДУМЫВАТЬ) ===' +
          '\nЦена = ' + (px != null ? currencySymbol + px : 'н/д') +
          '\nMarket cap = ' + fmtCapCur(cap, isMoex) +
          '\nP/E = ' + (peVal != null ? (+peVal).toFixed(2) : 'н/д') +
          (epsVal != null ? '\nEPS = ' + (+epsVal).toFixed(2) : '') +
          '\n52W high = ' + (yH != null ? currencySymbol + yH : 'н/д') +
          '\n52W low = ' + (yL != null ? currencySymbol + yL : 'н/д') +
          '\nДивиденд (доходность) = ' + (divY != null ? divY + '%' : 'н/д') +
          '\nПозиция в 52W = ' + (pos != null ? pos + '% от минимума (0%=у годового дна, 100%=у годового пика)' : 'н/д') +
          '\nЭто единственный источник для price, priceNum, week52Low/High (+Num), marketCap, P/E, дивиденда, atHigh/позиции. ' +
          'Поле "н/д" — оставь "н/д"/пусто, НЕ подставляй своё число. Запрещено брать эти цифры из памяти или из текста веб-поиска.'
        : '';

      const priceInstruction = currentPrice
        ? '\n\nТекущая цена ' + ticker + ' = ' + currencySymbol + currentPrice +
          (isMoex ? ' (РУБЛИ МОСБИРЖА).' : ' (USD).') +
          ' price="' + currencySymbol + currentPrice + '", priceNum=' + currentPrice + '.' +
          (isMoex ? ' ВСЕ цены в РУБЛЯХ ₽. exchange="MOEX".' : '') + ' НЕ используй другие числа как цену акции.'
        : '\n\nЦена не подтверждена источником — поле цены оставь пустым/«н/д», не выдумывай.';

      const insiderInstruction = '\n\nПОЛЕ insiders: бери ТОЛЬКО реальные сделки из веб-данных (Form 4 / OpenInsider / раскрытия). Для каждой: name, role, type (buy/sell), amount, shares, date — точная дата из Form 4 ("15 июн 2026"); если даты нет — хотя бы месяц. НЕТ сделки в данных — не показывай. Нет подтверждённых сделок — верни []. НИКОГДА не выдумывай инсайдеров, даты, суммы, акции.';

      const dateInstruction =
        '\n\n=== СОБЫТИЯ И ДАТЫ (ТОЧНОСТЬ) ===' +
        '\nСегодня 14 июня 2026.' +
        ' В events дай 4-6 событий: недавние подтверждённые факты (urgent=false) И будущие катализаторы.' +
        ' Даты events.date и insiders.date — ТОЛЬКО реальные из веб-данных ("15 июн 2026").' +
        ' Нет точной даты будущего события — "ожидается Q3 2026", без выдуманного числа.' +
        ' urgent=true — только подтверждённые будущие события в пределах ~30 дней. Прошедшие НИКОГДА не urgent.';

      const anticipationInstruction =
        '\n\n=== БЛОК ПРЕДВОСХИЩЕНИЕ — 5 ИНДИКАТОРОВ ===' +
        '\nПострой причинно-следственную цепочку ВВЕРХ по поставкам для ' + ticker + ': поставщики и их заказы, входное сырьё и цены, загрузка фабрик/OEM, законтрактованный пайплайн, опережающие сигналы спроса, регуляторика.' +
        ' Эталон: заказы тайваньских OEM (Feng Tay, Pou Chen) опережают выручку Nike на 1-2 квартала — примени ТАКУЮ ЖЕ логику к ' + ticker + '.' +
        ' anticipationInd1..5: название + механизм + лаг. Числа ТОЛЬКО из веб-данных; нет числа — качественно, без выдумок.' +
        (isMoex
          ? '\nВАЖНО — ЭТО РОССИЙСКАЯ БУМАГА (МОСБИРЖА): запрещено притягивать американские макроиндикаторы (LEI/Leading Economic Index, ISM, Conference Board, US-нонфарм и т.п.) — они к РФ-эмитенту не относятся. Используй РЕЛЕВАНТНЫЕ для РФ опережающие сигналы: ключевая ставка ЦБ РФ и её траектория, инфляция РФ, RGBI/доходности ОФЗ, курс рубля; для банка — динамика кредитного портфеля, стоимость фондирования, чистая процентная маржа, резервы/NPL, норматив Н1.0; для экспортёра — мировые цены на его сырьё. Конкретное число индикатора называй ТОЛЬКО если оно есть в веб-данных выше.'
          : '\nНе называй числовое значение макроиндикатора (индекс/ставка/%), которого нет в веб-данных выше — опиши механизм качественно.');

      const leadingNote = leadingData
        ? '\n\n=== ОПЕРЕЖАЮЩИЙ ИНДИКАТОР (РЕАЛЬНЫЕ ДАННЫЕ 2026) ===\n' + leadingData + '\nИспользуй эти реальные числа в anticipationInd1..5. НЕ бери из памяти.'
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
        '\n\nКРИТИЧНО: Числовые поля (цена, 52W, market cap, P/E, дивиденд) — ТОЛЬКО из блока ТОЧНЫЕ ЧИСЛА. Остальное — из данных выше. Нет данных → "н/д"/пусто.' +
        '\nВ bullCase/bearCase/verdict_text/anticipation тоже НЕ выдумывай числа: проценты, цели и уровни считай ТОЛЬКО от цены и 52W из блока ТОЧНЫЕ ЧИСЛА; конкретные цифры по прибыли/выручке/ставкам/индикаторам бери ТОЛЬКО из веб-данных, иначе формулируй качественно без числа.' +
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
      const tryScreen = async (base) => { const r = await fetch(base + params.toString()); return r.json(); };

      try {
        let data = await tryScreen(STABLE);
        if (!Array.isArray(data)) {
          const v3data = await tryScreen(V3);
          if (Array.isArray(v3data)) { data = v3data; }
          else {
            const msg = (data && (data['Error Message'] || data.error || data.message)) || (v3data && (v3data['Error Message'] || v3data.error || v3data.message)) || 'FMP вернул не список (проверь ключ/лимит)';
            return res.json({ error: msg, results: [] });
          }
        }
        const results = data.slice(0, f.limit || 30).map((x) => ({
          symbol: x.symbol, name: x.companyName || '', price: x.price ?? null, marketCap: x.marketCap ?? null,
          sector: x.sector || '', industry: x.industry || '', volume: x.volume ?? null, beta: x.beta ?? null,
          exchange: x.exchangeShortName || x.exchange || '', country: x.country || ''
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
