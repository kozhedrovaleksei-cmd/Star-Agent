// ════════════════════════════════════════════════════════════════
// signal_contract.js — канонический контракт сигнала STARK · Глобус
// Источник истины для:
//   1) Analyzer-промпта  — форма, которую LLM ОБЯЗАН вернуть (только JSON)
//   2) api/analyze       — validateSignal() перед upsert в Supabase
//   3) фронта-глобуса    — рендер дуг origin → target
// Меняешь форму — меняешь ТОЛЬКО здесь. Pure ESM, без TypeScript.
// ════════════════════════════════════════════════════════════════

// Фикс-таксономия секторов STARK
export const SECTORS = [
  'Полупроводники/AI', 'Мега-тех', 'Медиа/Комм', 'Потребительский',
  'Оборона/Аэрокосмос', 'Энергетика', 'Финансы', 'Здравоохранение',
  'Промышленность', 'Крипто', 'Прочее'
];

// Эталон одной строки — ровно это Analyzer возвращает (только JSON, без преамбулы/Markdown)
export const SIGNAL_EXAMPLE = {
  event_id: 'tw-quake-2026-06-25',            // стабильный → dedup (upsert on conflict)
  headline: 'M6.2 earthquake near Hsinchu, TSMC fabs under inspection',
  source: 'Reuters',
  url: 'https://www.reuters.com/...',
  published_date: '2026-06-25',
  origin_country: 'Taiwan',
  origin_lat: 23.7,
  origin_lng: 121.0,
  sector: 'Полупроводники/AI',
  severity: 'high',                           // low | medium | high → пульс дуги
  targets: [
    {
      ticker: 'TSM', name: 'Taiwan Semiconductor',
      hq_lat: 24.77, hq_lng: 121.0,
      impact_score: -0.82, confidence: 0.70,
      chain: 'Эпицентр в ~30км от фабрик Hsinchu → риск остановки 3нм линий'
    },
    {
      ticker: 'NVDA', name: 'NVIDIA',
      hq_lat: 37.37, hq_lng: -121.96,
      impact_score: -0.45, confidence: 0.60,
      chain: 'TSMC — единственный производитель Blackwell → срыв поставок'
    }
  ],
  second_order: [
    { ticker: 'ASML', why: 'Простой фабрик → пауза в заказах EUV' },
    { ticker: 'AVGO', why: 'Та же литография на TSMC' }
  ],
  bull_case_counter:
    'TSMC держит 90+ дней буферных запасов; фабрики спроектированы под сейсмику Тайваня — простой может быть <48ч',
  raw: null                                   // полный сырой вывод (заполняет api перед записью)
};

const inRange = (n, lo, hi) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;

// ── Ворота перед upsert: кривой вывод LLM не попадёт на глобус (Герчик: система > импульс) ──
export function validateSignal(s) {
  const e = [];
  if (!s || typeof s !== 'object') return { ok: false, errors: ['not an object'] };

  if (!s.event_id)       e.push('event_id обязателен (dedup)');
  if (!s.headline)       e.push('headline пуст');
  if (!s.origin_country) e.push('origin_country пуст');
  if (!inRange(s.origin_lat, -90, 90))   e.push('origin_lat вне -90..90');
  if (!inRange(s.origin_lng, -180, 180)) e.push('origin_lng вне -180..180');
  if (s.sector && !SECTORS.includes(s.sector)) e.push(`sector не из таксономии: ${s.sector}`);
  if (!['low', 'medium', 'high'].includes(s.severity)) e.push('severity должен быть low|medium|high');

  if (!Array.isArray(s.targets) || s.targets.length === 0) {
    e.push('targets пуст — дугу некуда вести');
  } else {
    s.targets.forEach((t, i) => {
      if (!t.ticker)                          e.push(`targets[${i}].ticker пуст`);
      if (!inRange(t.hq_lat, -90, 90))        e.push(`targets[${i}].hq_lat вне -90..90`);
      if (!inRange(t.hq_lng, -180, 180))      e.push(`targets[${i}].hq_lng вне -180..180`);
      if (!inRange(t.impact_score, -1, 1))    e.push(`targets[${i}].impact_score вне -1..1`);
      if (!inRange(t.confidence, 0, 1))       e.push(`targets[${i}].confidence вне 0..1`);
      if (!t.chain)                           e.push(`targets[${i}].chain пуст (нужна цепочка)`);
    });
  }

  if (!s.bull_case_counter) e.push('bull_case_counter обязателен (без него — bias)');

  return { ok: e.length === 0, errors: e };
}

// Хелпер: стабильный event_id из заголовка + даты (для dedup), без внешних либ
export function makeEventId(headline = '', publishedDate = '') {
  const base = `${headline}|${publishedDate}`.toLowerCase().trim();
  let h = 0;
  for (let i = 0; i < base.length; i++) {
    h = (Math.imul(31, h) + base.charCodeAt(i)) | 0;
  }
  return 'evt-' + (h >>> 0).toString(36);
}
