// api/diverge-one.js — STARK · Детектор расхождений (одна бумага)
// Вход:  GET /api/diverge-one?ticker=FCX
// Стек:  Tavily (грунт) -> callClaude (failover) -> код считает реальную корреляцию по FMP.
// Числа НЕ выдумываются: corr/gap считает код по ценам FMP. Модель даёт связи, вердикт-логику и карту.
// Чистый ESM. Никакого TypeScript-синтаксиса.

export const config = { maxDuration: 180 };

const TAVILY_KEY  = process.env.TAVILY_KEY;
const FMP_KEY     = process.env.FMP_KEY;
const CRAZYROUTER = process.env.CRAZYROUTER_KEY;
const OPENROUTER  = process.env.OPENROUTER_KEY;
const ANTHROPIC   = process.env.ANTHROPIC_API_KEY;

const MODEL_ANTHROPIC = 'claude-sonnet-4-6';
const MODEL_OR        = 'anthropic/claude-sonnet-4.5';

/* ---------- утиль ---------- */
function todayISO() { return new Date().toISOString().slice(0, 10); }

function extractJson(text) {
  if (!text) return null;
  let t = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = t.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) {
        const cand = t.slice(start, i + 1);
        try { return JSON.parse(cand); } catch (e) { return null; }
      } }
    }
  }
  return null;
}

/* ---------- Tavily (грунт под нарратив) ---------- */
async function tavily(query) {
  if (!TAVILY_KEY) return [];
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query,
        search_depth: 'advanced',
        max_results: 6,
        days: 7
      })
    });
    const j = await r.json();
    return (j.results || []).map(x => ({ title: x.title, content: (x.content || '').slice(0, 600), url: x.url }));
  } catch (e) { return []; }
}

/* ---------- FMP цены (закалённый best-effort + диагностика в ответ и в логи) ---------- */
async function fmpCloses(symbol, diag) {
  const log = (m) => { console.error(m); if (Array.isArray(diag)) diag.push(m); };
  if (!FMP_KEY) { log('[diverge] FMP нет ключа FMP_KEY в окружении'); return null; }
  if (!symbol) return null;
  const sym = encodeURIComponent(symbol);
  const urls = [
    `https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${sym}&apikey=${FMP_KEY}`,
    `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${sym}&apikey=${FMP_KEY}`,
    `https://financialmodelingprep.com/api/v3/historical-price-full/${sym}?serietype=line&apikey=${FMP_KEY}`,
    `https://financialmodelingprep.com/api/v3/historical-price-full/${sym}?apikey=${FMP_KEY}`
  ];
  for (const u of urls) {
    const tag = u.split('?')[0].replace('https://financialmodelingprep.com', '');
    try {
      const r = await fetch(u);
      if (!r.ok) {
        let bodyHint = '';
        try { bodyHint = ' :: ' + (await r.text()).slice(0, 160); } catch (e2) {}
        log('[diverge] FMP ' + symbol + ' HTTP ' + r.status + ' @ ' + tag + bodyHint);
        continue;
      }
      const j = await r.json();
      let rows = Array.isArray(j) ? j
        : (Array.isArray(j.historical) ? j.historical
        : (Array.isArray(j.results) ? j.results
        : (Array.isArray(j.historicalStockList) && j.historicalStockList[0] ? j.historicalStockList[0].historical : [])));
      if (!Array.isArray(rows) || !rows.length) {
        log('[diverge] FMP ' + symbol + ' пусто/чужой shape @ ' + tag + ' :: ' + JSON.stringify(j).slice(0, 180));
        continue;
      }
      let closes = rows.map(x => {
        const v = (x.close ?? x.adjClose ?? x.adjustedClose ?? x.price ?? x.close_price ?? x.c);
        return (typeof v === 'number' && isFinite(v)) ? v : null;
      }).filter(v => v !== null);
      if (closes.length < 25) { log('[diverge] FMP ' + symbol + ' мало точек (' + closes.length + ') @ ' + tag); continue; }
      // FMP отдаёт newest-first -> приводим к хронологии (старые -> свежие)
      const d0 = rows[0] && (rows[0].date || rows[0].datetime);
      const dN = rows[rows.length - 1] && (rows[rows.length - 1].date || rows[rows.length - 1].datetime);
      if (d0 && dN && String(d0) > String(dN)) closes = closes.reverse();
      else if (!d0) closes = closes.reverse();
      log('[diverge] FMP ' + symbol + ' OK: ' + closes.length + ' точек @ ' + tag);
      return closes;
    } catch (e) {
      log('[diverge] FMP ' + symbol + ' fetch err @ ' + tag + ' :: ' + (e && e.message));
      continue;
    }
  }
  return null;
}

/* ---------- Stooq: keyless-фолбэк дневных цен (проходит с Vercel-IP) ---------- */
async function stooqCloses(symbol, diag) {
  const log = (m) => { console.error(m); if (Array.isArray(diag)) diag.push(m); };
  try {
    const s = String(symbol).toLowerCase().replace(/[^a-z0-9.\-]/g, '');
    if (!s) return null;
    const u = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s + '.us')}&i=d`;
    const r = await fetch(u);
    if (!r.ok) { log('[diverge] STOOQ ' + symbol + ' HTTP ' + r.status); return null; }
    const txt = await r.text();
    const lines = txt.trim().split('\n');
    if (lines.length < 26 || !/date/i.test(lines[0])) { log('[diverge] STOOQ ' + symbol + ' нет данных :: ' + txt.slice(0, 120)); return null; }
    const header = lines[0].split(',');
    let idxClose = header.findIndex(h => /close/i.test(h));
    if (idxClose < 0) idxClose = 4;
    const closes = lines.slice(1).map(l => { const p = l.split(','); const v = parseFloat(p[idxClose]); return isFinite(v) ? v : null; }).filter(v => v !== null);
    if (closes.length < 25) { log('[diverge] STOOQ ' + symbol + ' мало точек (' + closes.length + ')'); return null; }
    log('[diverge] STOOQ ' + symbol + ' OK: ' + closes.length + ' точек (keyless fallback)');
    return closes; // Stooq уже хронологический: старые -> свежие
  } catch (e) { log('[diverge] STOOQ ' + symbol + ' err :: ' + (e && e.message)); return null; }
}

// единая точка получения цен: FMP -> Stooq
async function closesFor(symbol, diag) {
  const c = await fmpCloses(symbol, diag);
  if (c) return c;
  return await stooqCloses(symbol, diag);
}

/* ---------- математика: доходности, корреляция, разрыв ---------- */
function dailyReturns(s) {
  const r = [];
  for (let i = 1; i < s.length; i++) if (s[i - 1] > 0) r.push(s[i] / s[i - 1] - 1);
  return r;
}
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function corr(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 10) return null;
  const ax = a.slice(-n), bx = b.slice(-n), ma = mean(ax), mb = mean(bx);
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { const dx = ax[i] - ma, dy = bx[i] - mb; sxy += dx * dy; sx += dx * dx; sy += dy * dy; }
  const den = Math.sqrt(sx * sy);
  return den === 0 ? 0 : sxy / den;
}
function pctOver(s, win) {
  if (!s || s.length <= win) return null;
  const a = s[s.length - 1 - win], b = s[s.length - 1];
  if (!a || !b) return null;
  return b / a - 1;
}

// реальные числа по паре лидер/ведомый (или null, если FMP не отдал)
function buildMetrics(leadCloses, lagCloses) {
  if (!leadCloses || !lagCloses) return null;
  const lr = dailyReturns(leadCloses).slice(-60);
  const gr = dailyReturns(lagCloses).slice(-60);
  const corr60 = corr(lr, gr);
  const leadGap5  = pctOver(leadCloses, 5),  lagGap5  = pctOver(lagCloses, 5);
  const leadGap20 = pctOver(leadCloses, 20), lagGap20 = pctOver(lagCloses, 20);
  const pp = (x) => (x == null) ? null : +(x * 100).toFixed(2);
  const corrLabel = corr60 == null ? 'нет данных'
    : (Math.abs(corr60) >= 0.5 ? 'связь живая'
    : (Math.abs(corr60) >= 0.25 ? 'связь слабая' : 'связь почти распалась'));
  return {
    corr60: corr60 == null ? null : +corr60.toFixed(2),
    corr_label: corrLabel,
    leader_5d_pct: pp(leadGap5), laggard_5d_pct: pp(lagGap5),
    leader_20d_pct: pp(leadGap20), laggard_20d_pct: pp(lagGap20),
    gap_5d_pp: (leadGap5 != null && lagGap5 != null) ? +(((leadGap5 - lagGap5) * 100)).toFixed(2) : null,
    gap_20d_pp: (leadGap20 != null && lagGap20 != null) ? +(((leadGap20 - lagGap20) * 100)).toFixed(2) : null,
    note: 'corr60 — корреляция дневных доходностей за ~60 сессий. gap — разрыв доходностей лидера и ведомого (пп). Источник цен: FMP EOD.'
  };
}

/* ---------- LLM failover: Crazyrouter -> OpenRouter -> Anthropic ---------- */
async function callClaude(system, user) {
  const body = (model) => ({ model, max_tokens: 4000, system, messages: [{ role: 'user', content: user }] });

  // 1) Crazyrouter (Anthropic-совместимый)
  if (CRAZYROUTER) {
    try {
      const r = await fetch('https://api.crazyrouter.ai/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': CRAZYROUTER, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body(MODEL_ANTHROPIC))
      });
      if (r.ok) { const j = await r.json(); const t = (j.content || []).map(b => b.text || '').join(''); if (t) return t; }
      else console.error('[diverge] crazyrouter HTTP ' + r.status);
    } catch (e) { console.error('[diverge] crazyrouter err :: ' + (e && e.message)); }
  }
  // 2) OpenRouter (OpenAI-совместимый)
  if (OPENROUTER) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER}` },
        body: JSON.stringify({ model: MODEL_OR, max_tokens: 4000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
      });
      if (r.ok) { const j = await r.json(); const t = j.choices?.[0]?.message?.content || ''; if (t) return t; }
      else console.error('[diverge] openrouter HTTP ' + r.status);
    } catch (e) { console.error('[diverge] openrouter err :: ' + (e && e.message)); }
  }
  // 3) Anthropic direct
  if (ANTHROPIC) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body(MODEL_ANTHROPIC))
      });
      if (r.ok) { const j = await r.json(); const t = (j.content || []).map(b => b.text || '').join(''); if (t) return t; }
      else console.error('[diverge] anthropic HTTP ' + r.status);
    } catch (e) { console.error('[diverge] anthropic err :: ' + (e && e.message)); }
  }
  return null;
}

/* ---------- промпт ---------- */
function buildPrompt(ticker, news) {
  const grounding = news.length
    ? news.map((n, i) => `[${i + 1}] ${n.title}\n${n.content}\nURL: ${n.url}`).join('\n\n')
    : '(свежего грунта по теме не нашлось — работай по структурной логике связей)';

  const system = `Ты — STARK, движок детекции расхождений (lead-lag divergence) для трейдинга по методу Алексея (Герчик: изоляция, дисциплина, никаких выдуманных чисел).
Тебе дают ВЕДОМЫЙ тикер. Твоя задача — найти его ЛИДЕРОВ (кто двигается первым) по трём слоям связи и вынести вердикт.

ТРИ СЛОЯ СВЯЗИ:
- commodity  — сырьё/металл/энергия, на котором завязана бумага (медь→FCX);
- supplier / customer / fab — цепочка поставок (ASML→TSMC→NVDA; Micron→LRCX);
- twin       — co-mention близнец по дуополии (FDX↔UPS);
- sector     — секторный прокси/ETF, если прямого лидера нет.

ВЕРДИКТЫ:
- LAG        — связь жива, ведомый отстал → кандидат на возврат корреляции (catchup);
- DECOUPLED  — связь сломалась по СВОЕЙ причине ведомого → слабость это информация, не лаг, НЕ фейдить;
- WATCH      — картина смешанная, нужен триггер;
- NO_SIGNAL  — расхождения нет, движутся синхронно.
Различай LAG и DECOUPLED по ПРИЧИНЕ из грунта: общий драйвер у пары → LAG; идиосинкразия ведомого (свой отчёт/новость/инсайдеры) → DECOUPLED.

КРИТИЧНО ПРО ЧИСЛА: ты НЕ считаешь корреляции и проценты — их посчитает код по ценам FMP. Не выдумывай цифры. Давай только связи, символы-прокси (реальные тикеры на US-биржах для FMP), логику и карту разведки.

ВЕРНИ СТРОГО ВАЛИДНЫЙ JSON без markdown, без текста вокруг:
{
  "leaders": [
    {"type":"commodity|supplier|customer|fab|twin|sector","name":"Человекочитаемое имя (с уточнением в скобках)","symbol":"FMP-тикер прокси, напр. TSM, ASML, MU, COPX","why":"механизм связи и почему именно этот лидер ведёт"}
  ],
  "primary_index": 0,
  "verdict":"LAG|DECOUPLED|WATCH|NO_SIGNAL",
  "verdict_reason":"Почему именно этот вердикт — со ссылкой на причину из грунта",
  "direction":"LONG_REVERSION|SHORT_REVERSION|AVOID|WATCH",
  "thesis":"2-4 предложения: вся цепочка лидер→ведомый, что ждём и при каком условии связь рвётся",
  "research_map":[
    {"what":"что проверить","where":"где смотреть (источник)","query":"точная строка запроса для поиска","watch_metric":"какую цифру/уровень мониторить"}
  ],
  "insider_watch":{"where":"OpenInsider / SEC Form 4 / Finviz по ведомому и лидеру","threshold":"порог сигнала (CEO/CFO от $500K — наверх)","note":"что именно ищем и как трактуем"}
}
leaders — 3-5 штук, первый по логике = основной (primary_index указывает на него). symbol обязателен и должен быть валидным тикером FMP (US). Язык всего текста — русский.`;

  const user = `ВЕДОМЫЙ ТИКЕР: ${ticker}
Дата: ${todayISO()}

СВЕЖИЙ ГРУНТ (Tavily, последние дни):
${grounding}

Найди лидеров ${ticker}, вынеси вердикт LAG/DECOUPLED/WATCH/NO_SIGNAL строго по причине из грунта, собери карту разведки. Только JSON.`;

  return { system, user };
}

/* ---------- handler ---------- */
export default async function handler(req, res) {
  const asOf = todayISO();
  const ticker = String((req.query && req.query.ticker) || '').toUpperCase().trim();
  if (!ticker) return res.status(400).json({ error: 'нет параметра ticker (пример: /api/diverge-one?ticker=FCX)' });

  try {
    // 1) грунт под нарратив
    const waves = await Promise.all([
      tavily(`${ticker} stock why moving today leader lagging peers supply chain`),
      tavily(`${ticker} divergence correlation peers commodity supplier customer`)
    ]);
    const seen = new Set();
    const news = [];
    for (const w of waves) for (const n of w) { if (n.url && !seen.has(n.url)) { seen.add(n.url); news.push(n); } }

    // 2) LLM: связи + вердикт + карта (без чисел)
    const { system, user } = buildPrompt(ticker, news);
    const raw = await callClaude(system, user);
    if (!raw) return res.status(502).json({ ticker, asOf, error: 'LLM не ответил (все провайдеры failover недоступны)' });

    const data = extractJson(raw);
    if (!data || !Array.isArray(data.leaders)) {
      return res.status(502).json({ ticker, asOf, error: 'LLM вернул не-JSON или без leaders', raw: String(raw).slice(0, 300) });
    }

    // 3) РЕАЛЬНЫЕ числа по паре — считает код, не модель
    let metrics = null;
    let pIdx = Number.isInteger(data.primary_index) ? data.primary_index : 0;
    if (pIdx < 0 || pIdx >= data.leaders.length) pIdx = 0;

    const fmpDiag = [];
    const lagCloses = await closesFor(ticker, fmpDiag);
    if (lagCloses) {
      // ищем первого лидера, для которого есть цены; он и становится основной парой
      const order = [pIdx, ...data.leaders.map((_, i) => i).filter(i => i !== pIdx)];
      for (const i of order) {
        const lsym = data.leaders[i] && data.leaders[i].symbol;
        if (!lsym) continue;
        const leadCloses = await closesFor(lsym, fmpDiag);
        if (leadCloses) { metrics = buildMetrics(leadCloses, lagCloses); pIdx = i; break; }
      }
    } else {
      fmpDiag.push('[diverge] нет цен по ведомому ' + ticker + ' ни из FMP, ни из Stooq — metrics остаётся null');
    }

    const out = {
      ticker, asOf,
      leaders: data.leaders,
      primary_index: pIdx,
      verdict: data.verdict || 'WATCH',
      verdict_reason: data.verdict_reason || '',
      direction: data.direction || '',
      thesis: data.thesis || '',
      metrics,                          // реальные числа (или null, если оба источника молчат)
      research_map: data.research_map || [],
      insider_watch: data.insider_watch || null,
      sources: news.map(n => ({ title: n.title, url: n.url })),
      price_diag: fmpDiag,              // причина «нет чисел» видна сразу в ответе
      fmp_key_present: !!FMP_KEY
    };
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ ticker, asOf, error: String(e && e.message || e) });
  }
}
