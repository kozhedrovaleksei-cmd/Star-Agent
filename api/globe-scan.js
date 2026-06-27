// ════════════════════════════════════════════════════════════════
// api/globe-scan.js — STARK ГЛОБУС · мозг автономного радара
// Tavily (новости) → LLM (анализ в контракт) → код ставит координаты → Supabase upsert
// Триггер: n8n Schedule 30m → GET этого эндпоинта (НЕ Vercel Cron — Hobby = 1/сут)
// Pure ESM. Импортирует lib/* — они должны быть закоммичены.
// ════════════════════════════════════════════════════════════════

import { validateSignal, makeEventId, SECTORS } from '../lib/signal_contract.js';
import { isOurs, sectorOf } from '../lib/stark_universe.js';
import { resolveHQ, originCoords } from '../lib/geo_resolve.js';

export const config = { maxDuration: 180 };

// ── ENV (Vercel → Settings → Environment Variables → Production) ──
const TAVILY     = process.env.TAVILY_KEY || process.env.TAVILY_API_KEY || '';
const OPENROUTER = process.env.OPENROUTER_KEY || '';
const ANTHROPIC  = process.env.ANTHROPIC_API_KEY || '';
const FMP        = process.env.FMP_KEY || '';
const SB_URL     = process.env.SUPABASE_URL || '';
const SB_KEY     = process.env.SUPABASE_SECRET || '';   // service_role, НЕ anon!

const OPENROUTER_MODEL = 'anthropic/claude-sonnet-4-5';
const ANTHROPIC_MODEL  = 'claude-sonnet-4-5';

// ── ПУЛ ЗАПРОСОВ ПО СЕКТОРАМ (ротация, чтобы оживить ВСЮ доску) ──
// За вызов берём окно из 5 (см. pickQueries). За ~6ч прокручивается весь рынок.
const QUERY_POOL = [
  'Taiwan TSMC semiconductor chip supply export control disruption',
  'NVIDIA AMD Broadcom AI chip demand datacenter guidance',
  'Apple Microsoft Google Meta Amazon big tech earnings guidance',
  'Lockheed RTX Northrop defense contractor military budget order',
  'oil gas energy OPEC Exxon Chevron production price shock',
  'Nike Starbucks McDonalds consumer retail demand spending',
  'Eli Lilly UnitedHealth Pfizer pharma healthcare drug FDA',
  'JPMorgan Visa Mastercard bank finance credit interest rate',
  'Federal Reserve inflation rate decision US economy data',
  'geopolitics conflict sanctions tariff trade war supply chain',
  'Tesla EV auto production demand China market',
  'gold copper uranium metals commodity mining price'
];
// окно ротации: меняется каждые 30 минут, обходит весь пул
function pickQueries(n = 5) {
  const slot = Math.floor(Date.now() / (30 * 60 * 1000));
  const out = [];
  for (let i = 0; i < n; i++) out.push(QUERY_POOL[(slot + i) % QUERY_POOL.length]);
  // макро/гео всегда в окне как якорь рынка
  if (!out.includes(QUERY_POOL[8])) out.push(QUERY_POOL[8]);
  return [...new Set(out)];
}

// ── приоритетные тикеры: широкий срез по секторам (а не только чипы) ──
const PRIORITY_TICKERS = [
  'AAPL','MSFT','GOOGL','META','AMZN',
  'NVDA','AMD','TSM','AVGO','QCOM',
  'TSLA','LMT','RTX','NOC','GD',
  'XOM','CVX','COP','NKE','SBUX',
  'MCD','BKNG','JPM','V','MA',
  'UNH','LLY','PFE','DIS','BAC'
];

// ── Tavily: одна поисковая волна ────────────────────────────────
async function tavily(query) {
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TAVILY },
      body: JSON.stringify({ query, topic: 'news', days: 3, search_depth: 'advanced', max_results: 5 })
    });
    const d = await r.json();
    return (d.results || []).map(x => ({
      title: x.title, url: x.url,
      content: (x.content || '').slice(0, 600),
      published_date: x.published_date || null
    }));
  } catch { return []; }
}

// ── LLM с фолбэком: OpenRouter → Anthropic ──────────────────────
async function callLLM(system, user) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 170000);
  try {
    if (OPENROUTER) {
      try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST', signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENROUTER },
          body: JSON.stringify({
            model: OPENROUTER_MODEL, temperature: 0.2, max_tokens: 8000,
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
          })
        });
        const d = await r.json();
        const text = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
        if (text) return { text, provider: 'openrouter' };
      } catch (e) { /* падаем в Anthropic */ }
    }
    if (ANTHROPIC) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL, max_tokens: 8000, system,
          messages: [{ role: 'user', content: user }]
        })
      });
      const d = await r.json();
      const text = d && d.content && d.content[0] && d.content[0].text;
      if (text) return { text, provider: 'anthropic' };
    }
    return { text: null, provider: 'none' };
  } finally { clearTimeout(timer); }
}

// ── Извлечь JSON-массив из ответа, даже с мусором/метками вокруг ─
function extractJsonArray(text) {
  if (!text) return null;
  let t = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try { const a = JSON.parse(t); return Array.isArray(a) ? a : [a]; } catch (e) {}
  const i = t.indexOf('['), j = t.lastIndexOf(']');
  if (i !== -1 && j !== -1 && j > i) {
    const slice = t.slice(i, j + 1);
    try { const a = JSON.parse(slice); return Array.isArray(a) ? a : [a]; } catch (e) {}
  }
  const objs = [];
  let depth = 0, start = -1;
  for (let k = 0; k < t.length; k++) {
    const c = t[k];
    if (c === '{') { if (depth === 0) start = k; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && start !== -1) { objs.push(t.slice(start, k + 1)); start = -1; } }
  }
  const parsed = [];
  for (const o of objs) { try { parsed.push(JSON.parse(o)); } catch (e) {} }
  return parsed.length ? parsed : null;
}

// ── Промпт: LLM отдаёт ТОЛЬКО анализ, без координат ─────────────
function buildSystem(ourTickers) {
  const schema = [
    '{',
    '  "headline": "краткий заголовок события НА РУССКОМ",',
    '  "source": "издание",',
    '  "url": "ссылка из новости",',
    '  "published_date": "YYYY-MM-DD или null",',
    '  "origin_country": "страна события на английском (Taiwan, China, USA, Netherlands)",',
    '  "sector": "ОДИН из: ' + SECTORS.join(' | ') + '",',
    '  "severity": "low | medium | high",',
    '  "targets": [',
    '    { "ticker": "TSM", "name": "Taiwan Semiconductor",',
    '      "impact_score": -0.82, "confidence": 0.7,',
    '      "chain": "конкретная цепочка НА РУССКОМ: почему это бьёт по тикеру" }',
    '  ],',
    '  "second_order": [ { "ticker": "ASML", "why": "эффект второго порядка НА РУССКОМ" } ],',
    '  "bull_case_counter": "ОБЯЗАТЕЛЬНО НА РУССКОМ: сильнейший контраргумент, без hopium"',
    '}'
  ].join('\n');

  return [
    'Ты — аналитик причинно-следственных связей рынка США. На входе свежие новости.',
    'Задача: найти события, которые НЕГАТИВНО или ПОЗИТИВНО бьют по конкретным акциям через цепочку поставок / макро / второй порядок.',
    '',
    'ПРИОРИТЕТ — эти тикеры (наш юниверс), но можно и вне его, если связь сильная:',
    ourTickers.join(', '),
    '',
    'Верни ТОЛЬКО валидный JSON-массив (начни с [ и закончи ]). Без преамбулы, без Markdown, без ```. Каждый элемент:',
    schema,
    '',
    'ЖЁСТКО:',
    '- ВЫВОД: только JSON-массив, первый символ [ , последний ] . Никакого текста до или после.',
    '- ЯЗЫК: headline, chain, second_order.why и bull_case_counter — ВСЕГДА на русском, даже если источник английский. Переводи смысл, не дословно. Тикеры и названия компаний — латиницей как есть.',
    '- НЕ выдумывай числа и факты — только то, что есть в новостях.',
    '- НЕ указывай координаты — это сделает код.',
    '- impact_score от -1 до 1, confidence от 0 до 1.',
    '- РАСПРЕДЕЛЯЙ сигналы по РАЗНЫМ секторам и компаниям — не зацикливайся на полупроводниках.',
    '- Если несколько новостей описывают ОДНО событие — выдай ОДИН сигнал (склей, не дублируй).',
    '- Максимум 12 сигналов. Если событие незначимое или цели нет — НЕ включай.',
    '- bull_case_counter обязателен для каждого сигнала.'
  ].join('\n');
}

// ── Обогащение: код ставит координаты + чинит сектор/severity ────
async function enrich(s) {
  const o = originCoords(s.origin_country);
  if (o) { s.origin_lat = o.lat; s.origin_lng = o.lng; }
  if (!SECTORS.includes(s.sector)) s.sector = 'Прочее';
  if (!['low', 'medium', 'high'].includes(s.severity)) s.severity = 'medium';
  for (const t of (s.targets || [])) {
    const hq = await resolveHQ(t.ticker, { fmpKey: FMP });
    if (hq) { t.hq_lat = hq.lat; t.hq_lng = hq.lng; if (!t.name) t.name = t.ticker; }
  }
  s.event_id = s.event_id || makeEventId(s.headline, s.published_date);
  s.raw = null;
  return s;
}

// ── Upsert в Supabase через PostgREST (без SDK) ─────────────────
async function upsert(signals) {
  if (!SB_URL || !SB_KEY) return { written: 0, error: 'нет SUPABASE_URL/SECRET' };
  const r = await fetch(SB_URL + '/rest/v1/signals?on_conflict=event_id', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY,
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(signals)
  });
  if (!r.ok) return { written: 0, error: r.status + ': ' + (await r.text()).slice(0, 300) };
  return { written: signals.length };
}

// ── Handler ─────────────────────────────────────────────────────
export default async function handler(req, res) {
  const QUERIES = pickQueries(5);
  const diag = { queries: QUERIES.length, queryList: QUERIES, evidence: 0, provider: null,
                 parsed: 0, valid: 0, written: 0, errors: [] };
  try {
    const waves = await Promise.all(QUERIES.map(tavily));
    const evidence = waves.flat();
    diag.evidence = evidence.length;
    if (!evidence.length) return res.status(200).json({ ...diag, verdict: '⚠️ Tavily 0 новостей' });

    const ourTickers = PRIORITY_TICKERS.slice();

    const evidenceBlock = evidence.map((e, i) =>
      '[' + (i + 1) + '] ' + (e.published_date || 'дата?') + ' · ' + e.title + '\n' + e.content + '\n' + e.url
    ).join('\n\n');

    const { text, provider } = await callLLM(buildSystem(ourTickers), evidenceBlock);
    diag.provider = provider;
    if (!text) return res.status(200).json({ ...diag, verdict: '❌ LLM не ответил' });

    const arr = extractJsonArray(text);
    if (!arr || !arr.length) {
      return res.status(200).json({ ...diag, verdict: '❌ JSON не распарсился', sample: text.slice(0, 300) });
    }
    diag.parsed = arr.length;

    const valid = [];
    for (const raw of arr) {
      const s = await enrich(raw);
      const v = validateSignal(s);
      if (v.ok) valid.push(s);
      else diag.errors.push({ headline: (s.headline || '').slice(0, 50), errors: v.errors });
    }
    diag.valid = valid.length;

    if (valid.length) {
      const u = await upsert(valid);
      diag.written = u.written;
      if (u.error) diag.errors.push({ upsert: u.error });
    }

    return res.status(200).json({
      ...diag,
      verdict: diag.written > 0 ? ('✅ записано ' + diag.written + ' сигналов на глобус') : '⚠️ ничего не записано (см. errors)'
    });
  } catch (e) {
    return res.status(200).json({ ...diag, verdict: '❌ исключение', error: String(e).slice(0, 300) });
  }
}
