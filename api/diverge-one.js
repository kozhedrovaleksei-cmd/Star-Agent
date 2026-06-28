// api/diverge-one.js
// STARK — анализ одного тикера: расхождение (LAG/DECOUPLED) + карта разведки.
// Вход:  GET /api/diverge-one?ticker=FCX
// Стек:  Tavily (грунт) -> callClaude (failover) -> код считает реальную корреляцию по FMP.
// Числа НЕ выдумываются: corr/gap считает код по ценам FMP. Модель даёт связи, вердикт-логику и карту.
// Чистый ESM. Никакого TypeScript-синтаксиса.

export const config = { maxDuration: 180 };

const TAVILY_KEY    = process.env.TAVILY_KEY;
const FMP_KEY       = process.env.FMP_KEY;
const CRAZYROUTER   = process.env.CRAZYROUTER_KEY;
const OPENROUTER    = process.env.OPENROUTER_KEY;
const ANTHROPIC     = process.env.ANTHROPIC_API_KEY;

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

/* ---------- Tavily ---------- */
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

/* ---------- FMP цены (best-effort, c фолбэком) ---------- */
async function fmpCloses(symbol) {
  if (!FMP_KEY || !symbol) return null;
  const urls = [
    `https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`,
    `https://financialmodelingprep.com/api/v3/historical-price-full/${encodeURIComponent(symbol)}?serietype=line&apikey=${FMP_KEY}`
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const j = await r.json();
      let rows = Array.isArray(j) ? j : (j.historical || j.results || []);
      if (!Array.isArray(rows) || !rows.length) continue;
      // newest-first у FMP -> разворачиваем в хронологический порядок
      const closes = rows
        .map(x => (typeof x.close === 'number' ? x.close : (typeof x.price === 'number' ? x.price : null)))
        .filter(v => v != null)
        .reverse();
      if (closes.length >= 25) return closes;
    } catch (e) { /* пробуем следующий */ }
  }
  return null;
}

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

/* ---------- LLM failover ---------- */
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
    } catch (e) {}
  }
  // 2) OpenRouter
  if (OPENROUTER) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENROUTER}` },
        body: JSON.stringify({ model: MODEL_OR, max_tokens: 4000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
      });
      if (r.ok) { const j = await r.json(); const t = j.choices?.[0]?.message?.content || ''; if (t) return t; }
    } catch (e) {}
  }
  // 3) Anthropic напрямую
  if (ANTHROPIC) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body(MODEL_ANTHROPIC))
    });
    const j = await r.json();
    const t = (j.content || []).map(b => b.text || '').join('');
    if (t) return t;
  }
  throw new Error('Все провайдеры LLM недоступны');
}

/* ---------- промпт ---------- */
const SYSTEM = `Ты — STARK, аналитический движок lead-lag расхождений. Отвечаешь СТРОГО валидным JSON и ничем больше: без преамбулы, без markdown-ограждений.
Логика:
- Для выбранного тикера найди 2-4 "лидера", с которыми он связан: сырьё, поставщик, клиент, близнец по дуополии, сектор, макро-драйвер.
- relation одно из: "commodity" | "supplier" | "customer" | "twin" | "sector" | "macro".
- Если лидер не торгуется как акция (сырьё/макро) — дай в поле ticker биржевой прокси-ETF (медь->"CPER", нефть->"XLE", золото->"GLD" и т.п.), чтобы можно было посчитать корреляцию.
- primary_index — индекс самого важного лидера в массиве leaders.
- verdict: "LAG" (связь жива, ведомый не успел -> возможный возврат), "DECOUPLED" (связь сломалась по своей причине -> ловушка, не фейдить), "NO_SIGNAL" (разрыва нет), "WATCH" (данных мало).
- НЕ выдумывай числа цен/процентов. Числа корреляции и разрыва посчитает код отдельно. Говори словами про логику.
- research_map: 4-7 пунктов "что проверить и где". Каждый: check (что проверяем), where (источник: OpenInsider/SEC Form 4/Finviz/Tavily/FMP/график), query (точная строка для поиска или метрика), watch_metric (конкретная цифра/уровень для слежения).
- insider_watch ОБЯЗАТЕЛЕН (правило пользователя): где смотреть инсайдерские покупки/продажи, порог (покупка/продажа CEO/CFO от $500K — выносить наверх), на что обратить внимание.
Язык всех текстовых полей — РУССКИЙ.
Схема:
{"leaders":[{"name":"","ticker":"","relation":"","why":""}],"primary_index":0,"verdict":"","verdict_reason":"","direction":"","thesis":"","research_map":[{"check":"","where":"","query":"","watch_metric":""}],"insider_watch":{"where":["",""],"threshold":"","note":""}}`;

/* ---------- handler ---------- */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ticker = String((req.query?.ticker || '')).trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
  if (!ticker) return res.status(400).json({ error: 'Передай ?ticker=XXX' });

  const asOf = todayISO();
  try {
    // 1) грунтуем нарратив
    const news = await tavily(`${ticker} stock why moving correlation peers supply chain ${asOf}`);
    const ctx = news.map((n, i) => `[${i + 1}] ${n.title}\n${n.content}`).join('\n\n').slice(0, 4000) || '(свежих новостей не найдено)';

    const user = `Сегодня: ${asOf}. Тикер для анализа: ${ticker}.
Свежий контекст из поиска:
${ctx}

Верни JSON по схеме. Помни: вердикт LAG/DECOUPLED определяется ПРИЧИНОЙ движения лидера (общая для пары -> LAG; своя у одного -> DECOUPLED).`;

    const raw = await callClaude(SYSTEM, user);
    const data = extractJson(raw);
    if (!data || !Array.isArray(data.leaders)) {
      return res.status(200).json({ ticker, asOf, error: 'Модель вернула неразборчивый ответ', raw: String(raw).slice(0, 800) });
    }

    // 2) считаем РЕАЛЬНУЮ корреляцию/разрыв с главным лидером
    const pIdx = Number.isInteger(data.primary_index) ? data.primary_index : 0;
    const primary = data.leaders[pIdx] || data.leaders[0] || null;
    let metrics = null;
    if (primary && primary.ticker) {
      const [cl, cp] = await Promise.all([fmpCloses(ticker), fmpCloses(primary.ticker)]);
      if (cl && cp) {
        const c60 = corr(dailyReturns(cl).slice(-60), dailyReturns(cp).slice(-60));
        const leadGap5 = pctOver(cp, 5), lagGap5 = pctOver(cl, 5);
        const leadGap20 = pctOver(cp, 20), lagGap20 = pctOver(cl, 20);
        const pp = (x) => x == null ? null : +(x * 100).toFixed(2);
        metrics = {
          pair: `${primary.ticker} (лидер) -> ${ticker} (ведомый)`,
          corr60: c60 == null ? null : +c60.toFixed(2),
          corrLabel: c60 == null ? 'нет данных' : (Math.abs(c60) >= 0.5 ? 'связь живая' : (Math.abs(c60) >= 0.3 ? 'связь слабая' : 'связь почти распалась')),
          leader_5d_pct: pp(leadGap5), laggard_5d_pct: pp(lagGap5),
          leader_20d_pct: pp(leadGap20), laggard_20d_pct: pp(lagGap20),
          gap_5d_pp: (leadGap5 != null && lagGap5 != null) ? +(((leadGap5 - lagGap5) * 100)).toFixed(2) : null,
          gap_20d_pp: (leadGap20 != null && lagGap20 != null) ? +(((leadGap20 - lagGap20) * 100)).toFixed(2) : null,
          note: 'corr60 — корреляция дневных доходностей за ~60 сессий. gap — разрыв доходностей лидера и ведомого (пп). Источник цен: FMP EOD.'
        };
      }
    }

    return res.status(200).json({
      ticker, asOf,
      leaders: data.leaders,
      primary_index: pIdx,
      verdict: data.verdict || 'WATCH',
      verdict_reason: data.verdict_reason || '',
      direction: data.direction || '',
      thesis: data.thesis || '',
      metrics,                          // реальные числа (или null, если FMP не отдал)
      research_map: data.research_map || [],
      insider_watch: data.insider_watch || null,
      sources: news.map(n => ({ title: n.title, url: n.url }))
    });
  } catch (e) {
    return res.status(500).json({ ticker, asOf, error: String(e.message || e) });
  }
}
