// api/globe-query.js — STARK ГЛОБУС «ПЛАСТИЛИН» (M2)
// Запрос свободным текстом → контракт сцены {focus, points[], arcs[], zones[], panel, sources[]}.
// ЗАКОН: LLM НИКОГДА не выдаёт координаты. LLM даёт ИМЕНА мест → координаты ставит КОД (геокодер + кеш).
// Провайдеры (failover): Crazyrouter(опц.) → OpenRouter → Anthropic direct. Тот же паттерн, что в globe-scan/analyze.
// ESM, чистый JS (не TypeScript). maxDuration 60, abort ~55с.

export const config = { maxDuration: 60 };

const TAVILY_KEY      = process.env.TAVILY_KEY;
const OPENROUTER_KEY  = process.env.OPENROUTER_KEY;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
const CRAZYROUTER_KEY = process.env.CRAZYROUTER_KEY;
const CRAZYROUTER_URL = process.env.CRAZYROUTER_URL; // напр. https://api.crazyrouter.../v1/chat/completions
const SUPA_URL        = process.env.SUPABASE_URL || 'https://wfoyypwscvcxriqbsnew.supabase.co';
const SUPA_SECRET     = process.env.SUPABASE_SECRET; // service_role
const MODEL_OR        = 'anthropic/claude-sonnet-4.5';
const MODEL_ANTH      = 'claude-sonnet-4-5-20250929';

/* ════════ ИЗВЕСТНЫЕ ГЕО-ТОЧКИ (мгновенно, без Nominatim) ════════ */
/* Горячие геополитические объекты + проливы/каналы, которых нет в стандартном гео-поиске как точек. */
const KNOWN_PLACES = {
  'strait of hormuz':       { lat: 26.57, lng: 56.25, display: 'Ормузский пролив' },
  'ормузский пролив':       { lat: 26.57, lng: 56.25, display: 'Ормузский пролив' },
  'taiwan strait':          { lat: 24.50, lng: 119.50, display: 'Тайваньский пролив' },
  'тайваньский пролив':     { lat: 24.50, lng: 119.50, display: 'Тайваньский пролив' },
  'suez canal':             { lat: 30.50, lng: 32.35, display: 'Суэцкий канал' },
  'суэцкий канал':          { lat: 30.50, lng: 32.35, display: 'Суэцкий канал' },
  'red sea':                { lat: 20.00, lng: 38.00, display: 'Красное море' },
  'красное море':           { lat: 20.00, lng: 38.00, display: 'Красное море' },
  'bab-el-mandeb':          { lat: 12.58, lng: 43.33, display: 'Баб-эль-Мандеб' },
  'south china sea':        { lat: 13.00, lng: 114.00, display: 'Южно-Китайское море' },
  'южно-китайское море':    { lat: 13.00, lng: 114.00, display: 'Южно-Китайское море' },
  'strait of malacca':      { lat: 2.50,  lng: 101.00, display: 'Малаккский пролив' },
  'panama canal':           { lat: 9.08,  lng: -79.68, display: 'Панамский канал' },
  'panama':                 { lat: 9.08,  lng: -79.68, display: 'Панама' },
  'persian gulf':           { lat: 27.00, lng: 51.00, display: 'Персидский залив' },
  'персидский залив':       { lat: 27.00, lng: 51.00, display: 'Персидский залив' },
  'black sea':              { lat: 43.00, lng: 34.00, display: 'Чёрное море' },
  'чёрное море':            { lat: 43.00, lng: 34.00, display: 'Чёрное море' },
  'donbas':                 { lat: 48.30, lng: 38.00, display: 'Донбасс' },
  'донбасс':                { lat: 48.30, lng: 38.00, display: 'Донбасс' },
  'gaza':                   { lat: 31.50, lng: 34.47, display: 'Газа' },
  'газа':                   { lat: 31.50, lng: 34.47, display: 'Газа' },
  'kerch strait':           { lat: 45.30, lng: 36.50, display: 'Керченский пролив' },
};

/* Базовые центроиды стран — дешёвый фолбэк, если Nominatim промахнулся. */
const COUNTRY_CENTROID = {
  'united states': [39.8, -98.6], 'usa': [39.8, -98.6], 'сша': [39.8, -98.6],
  'china': [35.0, 105.0], 'китай': [35.0, 105.0], 'taiwan': [23.7, 121.0], 'тайвань': [23.7, 121.0],
  'russia': [61.5, 105.0], 'россия': [61.5, 105.0], 'germany': [51.2, 10.4], 'германия': [51.2, 10.4],
  'japan': [36.2, 138.2], 'япония': [36.2, 138.2], 'india': [22.0, 79.0], 'индия': [22.0, 79.0],
  'ukraine': [49.0, 32.0], 'украина': [49.0, 32.0], 'iran': [32.0, 53.0], 'иран': [32.0, 53.0],
  'israel': [31.4, 35.0], 'израиль': [31.4, 35.0], 'south korea': [36.5, 127.8], 'korea': [36.5, 127.8],
  'saudi arabia': [24.0, 45.0], 'uae': [24.0, 54.0], 'оаэ': [24.0, 54.0], 'united kingdom': [54.0, -2.5],
  'uk': [54.0, -2.5], 'великобритания': [54.0, -2.5], 'france': [46.6, 2.4], 'франция': [46.6, 2.4],
  'brazil': [-10.0, -55.0], 'бразилия': [-10.0, -55.0], 'australia': [-25.0, 133.0],
  'netherlands': [52.2, 5.3], 'нидерланды': [52.2, 5.3], 'turkey': [39.0, 35.0], 'турция': [39.0, 35.0],
};

/* ════════ УТИЛИТЫ ════════ */
const norm = s => String(s || '').trim().toLowerCase();
function withTimeout(ms) { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return { signal: c.signal, clear: () => clearTimeout(t) }; }

/* ════ ГЕОКОДЕР: known → Supabase cache → Nominatim → centroid ════ */
async function supaGetPlace(q) {
  if (!SUPA_SECRET) return null;
  try {
    const to = withTimeout(4000);
    const r = await fetch(`${SUPA_URL}/rest/v1/places_cache?q=eq.${encodeURIComponent(q)}&select=lat,lng,display&limit=1`,
      { headers: { apikey: SUPA_SECRET, Authorization: 'Bearer ' + SUPA_SECRET }, signal: to.signal });
    to.clear();
    if (!r.ok) return null;
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length && rows[0].lat != null) return { lat: +rows[0].lat, lng: +rows[0].lng, display: rows[0].display };
  } catch (e) {}
  return null;
}
async function supaPutPlace(q, lat, lng, display) {
  if (!SUPA_SECRET) return;
  try {
    const to = withTimeout(4000);
    await fetch(`${SUPA_URL}/rest/v1/places_cache?on_conflict=q`, {
      method: 'POST',
      headers: { apikey: SUPA_SECRET, Authorization: 'Bearer ' + SUPA_SECRET, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ q, lat, lng, display: display || q, updated_at: new Date().toISOString() }),
      signal: to.signal
    });
    to.clear();
  } catch (e) {}
}
async function nominatim(place) {
  try {
    const to = withTimeout(6000);
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'STARK-Globe/1.0 (signal terminal)', 'Accept-Language': 'en' }, signal: to.signal });
    to.clear();
    if (!r.ok) return null;
    const j = await r.json();
    if (Array.isArray(j) && j.length && j[0].lat) return { lat: +j[0].lat, lng: +j[0].lon, display: j[0].display_name };
  } catch (e) {}
  return null;
}
function centroidFallback(place) {
  const p = norm(place);
  for (const k in COUNTRY_CENTROID) { if (p.includes(k)) { const c = COUNTRY_CENTROID[k]; return { lat: c[0], lng: c[1], display: place }; } }
  return null;
}
async function geocode(place) {
  const key = norm(place);
  if (!key) return null;
  if (KNOWN_PLACES[key]) return KNOWN_PLACES[key];
  const cached = await supaGetPlace(key);
  if (cached) return cached;
  const hit = await nominatim(place);
  if (hit) { supaPutPlace(key, hit.lat, hit.lng, hit.display).catch(() => {}); return hit; }
  return centroidFallback(place);
}

/* ════════ TAVILY (одна волна, заземление + источники) ════════ */
async function tavily(query) {
  if (!TAVILY_KEY) return { context: '', sources: [] };
  try {
    const to = withTimeout(15000);
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_KEY, query, search_depth: 'advanced', max_results: 6, include_answer: true, days: 7 }),
      signal: to.signal
    });
    to.clear();
    if (!r.ok) return { context: '', sources: [] };
    const j = await r.json();
    const results = j.results || [];
    const sources = results.slice(0, 6).map(x => ({ title: x.title, url: x.url }));
    const context = [(j.answer || ''), ...results.map(x => `• ${x.title}: ${String(x.content || '').slice(0, 320)}`)].join('\n');
    return { context, sources };
  } catch (e) { return { context: '', sources: [] }; }
}

/* ════════ LLM FAILOVER ════════ */
async function callOpenAICompat(url, key, model, system, user) {
  const to = withTimeout(45000);
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ model, max_tokens: 4000, temperature: 0.3, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    signal: to.signal
  });
  to.clear();
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const txt = j.choices?.[0]?.message?.content;
  if (!txt) throw new Error('empty');
  return txt;
}
async function callAnthropic(system, user) {
  const to = withTimeout(45000);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL_ANTH, max_tokens: 4000, temperature: 0.3, system, messages: [{ role: 'user', content: user }] }),
    signal: to.signal
  });
  to.clear();
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const txt = (j.content || []).map(b => b.text || '').join('\n').trim();
  if (!txt) throw new Error('empty');
  return txt;
}
async function callLLM(system, user) {
  const errs = [];
  if (CRAZYROUTER_KEY && CRAZYROUTER_URL) {
    try { return await callOpenAICompat(CRAZYROUTER_URL, CRAZYROUTER_KEY, MODEL_OR, system, user); }
    catch (e) { errs.push('crazyrouter:' + e.message); }
  }
  if (OPENROUTER_KEY) {
    try { return await callOpenAICompat('https://openrouter.ai/api/v1/chat/completions', OPENROUTER_KEY, MODEL_OR, system, user); }
    catch (e) { errs.push('openrouter:' + e.message); }
  }
  if (ANTHROPIC_KEY) {
    try { return await callAnthropic(system, user); }
    catch (e) { errs.push('anthropic:' + e.message); }
  }
  throw new Error('Все LLM-провайдеры недоступны → ' + errs.join(' | '));
}

/* ════ JSON-ЭКСТРАКТОР (тройная защита от обёрток/обрезки) ════ */
function extractJson(text) {
  if (typeof text !== 'string') return text;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) t = fence[1].trim();
  if (t[0] !== '{') { const a = t.indexOf('{'); if (a >= 0) t = t.slice(a); }
  try { return JSON.parse(t); } catch (e) {}
  const last = t.lastIndexOf('}'); if (last > 0) { try { return JSON.parse(t.slice(0, last + 1)); } catch (e) {} }
  let depth = 0, end = -1;
  for (let i = 0; i < t.length; i++) { if (t[i] === '{') depth++; else if (t[i] === '}') { depth--; if (depth === 0) { end = i; break; } } }
  if (end > 0) { try { return JSON.parse(t.slice(0, end + 1)); } catch (e) {} }
  throw new Error('JSON не распарсился');
}

/* ════════ ПРОМПТ ════════ */
const SYSTEM = `Ты — гео-движок STARK. По свободному запросу строишь СЕМАНТИЧЕСКУЮ сцену для 3D-глобуса.
ЖЕЛЕЗНЫЙ ЗАКОН: ты НИКОГДА не выдаёшь координаты (lat/lng). Координаты ставит код по ИМЕНИ места.
Ты возвращаешь СТРОГО ОДИН JSON-объект и НИЧЕГО больше (без префиксов, без markdown-обёртки).

Схема:
{
  "kind": "ticker" | "scene",
  "resolvedTicker": "TICKER" | null,   // тикер США/биржи, если запрос однозначно про одну публичную компанию; иначе null
  "title": "короткий заголовок сцены (рус)",
  "entities": [
    { "id":"e1", "name":"человекочитаемое имя", "place":"геокодируемая строка: 'Город, Регион, Страна' ИЛИ известный объект ('Strait of Hormuz')",
      "kind":"company|place|event|commodity", "ticker":"TICKER|null", "label":"короткая подпись на шаре", "sub":"1 строка контекста" }
  ],
  "arcs": [ { "fromId":"e1", "toId":"e2", "label":"причинно-следственная связь (рус)", "dir":"bull|bear|neutral|supply" } ],
  "zones": [ { "name":"имя зоны", "place":"геокодируемая строка", "note":"рыночное эхо (рус)", "tickers":["TICK"] } ],
  "panel": { "heading":"заголовок", "markdown":"разбор на РУССКОМ: что происходит, причинно-следственная цепочка, кто выигрывает/проигрывает, на что смотреть. Markdown допустим (## , **жирный**, списки).", "badges":["1-3 коротких тега"] },
  "sources": [ { "title":"...", "url":"..." } ]
}

Правила:
- Если запрос — одна публичная компания (по имени или тикеру) → kind:"ticker", resolvedTicker заполнен, entities можно оставить минимальными.
- Если запрос — событие/регион/война/сырьё/тема → kind:"scene": 2–8 entities (точки), осмысленные arcs (origin→бенефициар/жертва), zones для зон риска.
- "place" ОБЯЗАН быть геокодируемым: для компаний — город штаб-квартиры; для событий — конкретное место; для сырья — страна/регион добычи.
- Инсайдеры: если по компании всплыли покупки/продажи инсайдеров (особенно CEO/CFO $500K+) — отметь их прямо в panel.markdown.
- Никаких выдуманных чисел/координат. Источники бери из переданного контекста, если он есть. Пиши лаконично, по делу, на русском.`;

/* ════════ ХЭНДЛЕР ════════ */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const query = String((body && body.query) || '').trim().slice(0, 200);
  if (!query) return res.status(400).json({ ok: false, error: 'пустой запрос' });

  const today = new Date().toISOString().slice(0, 10);
  try {
    // 1) заземление
    const t = await tavily(query);
    // 2) семантика (без координат)
    const user = `Сегодня ${today}. Запрос пользователя: «${query}».\n\nКонтекст из поиска (может быть пустым):\n${t.context || '(пусто)'}\n\nВерни ОДИН JSON-объект по схеме.`;
    const raw = await callLLM(SYSTEM, user);
    const sem = extractJson(raw);

    // 3) тикер-кейс: координаты не нужны — фронт уйдёт в focusTicker по своей вселенной
    if (sem.kind === 'ticker' && sem.resolvedTicker) {
      return res.status(200).json({
        ok: true, kind: 'ticker', query,
        resolvedTicker: String(sem.resolvedTicker).toUpperCase().replace(/[^A-Z0-9.\-]/g, ''),
        title: sem.title || sem.resolvedTicker,
        panel: sem.panel || null,
        sources: sem.sources?.length ? sem.sources : t.sources
      });
    }

    // 4) пластилин: КОД ставит координаты по именам
    const entities = Array.isArray(sem.entities) ? sem.entities.slice(0, 10) : [];
    const zones = Array.isArray(sem.zones) ? sem.zones.slice(0, 6) : [];

    const geoEnt = await Promise.all(entities.map(async e => {
      const g = await geocode(e.place || e.name);
      if (!g) return null;
      return {
        id: e.id, name: e.name, kind: e.kind || 'place',
        ticker: e.ticker && String(e.ticker).toUpperCase().replace(/[^A-Z0-9.\-]/g, '') || null,
        label: e.label || e.name, sub: e.sub || '',
        lat: g.lat, lng: g.lng
      };
    }));
    const points = geoEnt.filter(Boolean);
    const byId = Object.fromEntries(points.map(p => [p.id, p]));

    const geoZones = await Promise.all(zones.map(async z => {
      const g = await geocode(z.place || z.name);
      if (!g) return null;
      return { name: z.name, lat: g.lat, lng: g.lng, note: z.note || '', tickers: Array.isArray(z.tickers) ? z.tickers : [] };
    }));
    const outZones = geoZones.filter(Boolean);

    const arcs = (Array.isArray(sem.arcs) ? sem.arcs : []).map(a => {
      const f = byId[a.fromId], to = byId[a.toId];
      if (!f || !to) return null;
      return { startLat: f.lat, startLng: f.lng, endLat: to.lat, endLng: to.lng, label: a.label || '', dir: a.dir || 'neutral' };
    }).filter(Boolean);

    // фокус: первая точка/зона, иначе центр США
    const focusOn = points[0] || outZones[0] || { lat: 39.8, lng: -98.6 };
    const focus = { lat: focusOn.lat, lng: focusOn.lng, altitude: points.length > 3 || outZones.length ? 2.0 : 1.6 };

    return res.status(200).json({
      ok: true, kind: 'scene', query,
      title: sem.title || query,
      focus, points, arcs, zones: outZones,
      panel: sem.panel || null,
      sources: (sem.sources && sem.sources.length) ? sem.sources : t.sources,
      diag: { entities: entities.length, geocoded: points.length, zones: outZones.length, arcs: arcs.length }
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message || 'ошибка движка сцены', query });
  }
}
