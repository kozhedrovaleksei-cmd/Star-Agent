// api/signals-cron.js — STARK ГЛОБУС: движок сигналов (Vercel Cron)
// Pure ESM. Деплой: GitHub edit-in-place → Vercel autodeploy. Тест: GET на /api/signals-cron.
// Цепочка: Tavily (параллельно) → LLM-классификатор (failover) → гео → дедуп url_hash → Supabase upsert.

export const config = { maxDuration: 180 };

// ---------- ENV ----------
const SUPABASE_URL    = process.env.SUPABASE_URL;       // https://wfoyypwscvcxriqbsnew.supabase.co
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;    // sb_secret_... (пишет, обходит RLS — НЕ во фронт)
const TAVILY_KEY      = process.env.TAVILY_KEY;
const OPENROUTER_KEY  = process.env.OPENROUTER_KEY;
const CRAZYROUTER_KEY = process.env.CRAZYROUTER_KEY;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_KEY;      // опц. прямой fallback
const CRON_SECRET     = process.env.CRON_SECRET;        // опц. защита эндпоинта

// ⚠️ Сверь с рабочим STARK AI Agent. Если Crazyrouter не OpenAI-совместим — поправь URL/модель тут.
const CRAZYROUTER_URL = process.env.CRAZYROUTER_URL || 'https://api.crazyrouter.ai/v1/chat/completions';

const ABORT_MS = 145000;

// Широкий охват US-рынка
const QUERIES = [
  'US stock market today earnings results guidance',
  'semiconductor chip AI Nvidia TSMC AMD export controls',
  'Federal Reserve interest rates inflation oil energy prices',
  'defense aerospace contract pharmaceutical FDA biotech',
  'big bank earnings financials cryptocurrency bitcoin ethereum'
];

// СТРОГО синхронно с фронтом stark-globe.html
const SECTORS = ['Полупроводники / AI','Мега-тех','Медиа / Комм','Потребительский','Оборона / Аэрокосмос','Энергетика','Финансы','Здравоохранение','Промышленность','Крипто','Прочее'];

const GEO = {
  'United States':[39.8,-98.6],'United States of America':[39.8,-98.6],'USA':[39.8,-98.6],
  'Taiwan':[23.7,121.0],'China':[35.9,104.2],'Japan':[36.2,138.3],'South Korea':[36.5,127.8],
  'Germany':[51.2,10.5],'United Kingdom':[54.0,-2.0],'Netherlands':[52.1,5.3],'France':[46.6,2.4],
  'India':[22.0,79.0],'Vietnam':[16.0,108.0],'Mexico':[23.6,-102.5],'Canada':[56.1,-106.3],
  'Israel':[31.5,34.8],'Saudi Arabia':[24.0,45.0],'Russia':[61.5,105.3],'Ukraine':[48.4,31.2],
  'Singapore':[1.35,103.8],'Hong Kong':[22.3,114.2],'Brazil':[-14.2,-51.9],'Italy':[42.8,12.8],
  'Switzerland':[46.8,8.2],'Australia':[-25.3,133.8],'Spain':[40.4,-3.7],'Ireland':[53.4,-8.2]
};

// Тот же хэш, что в n8n-ноде — дедуп совместим между движками
function hash(s){let h=5381;for(let i=0;i<s.length;i++){h=((h<<5)+h)^s.charCodeAt(i);}return (h>>>0).toString(16);}

function safeJson(txt){
  try { return JSON.parse(String(txt).replace(/```json|```/g,'').trim()); } catch(e){ return null; }
}

async function timedFetch(url, opts){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ABORT_MS);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// ---------- TAVILY ----------
async function tavilyOne(query){
  try {
    const r = await timedFetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TAVILY_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, topic: 'news', days: 1, max_results: 12, search_depth: 'advanced', include_answer: false })
    });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j.results) ? j.results : [];
  } catch(e){ return []; }
}

// ---------- LLM FAILOVER (Crazyrouter → OpenRouter → Anthropic) ----------
async function callOpenAICompat(url, key, model, sys, user){
  const r = await timedFetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role:'system', content: sys }, { role:'user', content: user }] })
  });
  if (!r.ok) throw new Error(`${r.status}`);
  const j = await r.json();
  const txt = j?.choices?.[0]?.message?.content;
  if (!txt) throw new Error('empty');
  return txt;
}

async function callAnthropic(sys, user){
  const r = await timedFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 4000, system: sys, messages: [{ role:'user', content: user }] })
  });
  if (!r.ok) throw new Error(`${r.status}`);
  const j = await r.json();
  const txt = (j?.content || []).map(b => b.text || '').join('');
  if (!txt) throw new Error('empty');
  return txt;
}

async function classify(sys, user){
  const chain = [];
  if (CRAZYROUTER_KEY) chain.push(['crazyrouter', () => callOpenAICompat(CRAZYROUTER_URL, CRAZYROUTER_KEY, 'anthropic/claude-haiku-4.5', sys, user)]);
  if (OPENROUTER_KEY)  chain.push(['openrouter',  () => callOpenAICompat('https://openrouter.ai/api/v1/chat/completions', OPENROUTER_KEY, 'anthropic/claude-haiku-4.5', sys, user)]);
  if (ANTHROPIC_KEY)   chain.push(['anthropic',   () => callAnthropic(sys, user)]);
  for (const [name, fn] of chain){
    try { const txt = await fn(); return { txt, via: name }; }
    catch(e){ /* следующий провайдер */ }
  }
  throw new Error('all LLM providers failed');
}

// ---------- PROMPT ----------
function buildPrompt(list){
  const sys = `Ты — классификатор рыночных сигналов STARK для трейдинга US-рынка. На вход — массив новостей (title, snippet, url, domain).

ЗАДАЧА: для каждой новости, релевантной публичной компании US-рынка ИЛИ макро-фактору, влияющему на сектор — верни объект:
{ticker, company, sector, direction, impact, country, headline, url}

ticker: биржевой тикер главной затронутой компании (NVDA, AAPL, XOM, JPM, LLY и т.д.). Если новость макро/секторная без явной компании — выбери самого репрезентативного лидера сектора (нефть->XOM, банки->JPM, оборона->LMT, чипы->NVDA, золото/майнинг по контексту).

sector: СТРОГО одно из (копируй точь-в-точь):
'Полупроводники / AI' | 'Мега-тех' | 'Медиа / Комм' | 'Потребительский' | 'Оборона / Аэрокосмос' | 'Энергетика' | 'Финансы' | 'Здравоохранение' | 'Промышленность' | 'Крипто' | 'Прочее'

direction: 'bull' | 'bear' | 'neutral' (ожидаемое влияние на тикер)
impact: целое 0-100 (сила влияния; будь консервативен)
country: страна СОБЫТИЯ на английском ('United States','Taiwan','China','Germany'...)
headline: краткий заголовок на русском, не длиннее 90 символов
url: ровно тот url, что пришёл

ПРАВИЛА: только реальные факты из заголовка/сниппета. НЕ выдумывай цифры, проценты, даты. Реклама, гороскопы, спорт, развлечения — пропускай. Не дублируй одинаковые события.

Верни СТРОГО JSON-массив объектов и НИЧЕГО больше. Без markdown, без пояснений. Если релевантного нет — верни [].`;
  const user = 'Новости (JSON):\n' + JSON.stringify(list);
  return { sys, user };
}

// ---------- ОСНОВНОЙ ХЭНДЛЕР ----------
export default async function handler(req, res){
  // защита: Vercel Cron шлёт Authorization: Bearer <CRON_SECRET>; ручной триггер ?key=
  if (CRON_SECRET){
    const auth = req.headers.authorization || '';
    const key  = (req.query && req.query.key) || '';
    if (auth !== `Bearer ${CRON_SECRET}` && key !== CRON_SECRET){
      return res.status(401).json({ error: 'unauthorized' });
    }
  }
  if (!SUPABASE_URL || !SUPABASE_SECRET) return res.status(500).json({ error: 'no supabase env' });
  if (!TAVILY_KEY) return res.status(500).json({ error: 'no tavily key' });

  try {
    // 1) Tavily параллельно
    const batches = await Promise.all(QUERIES.map(tavilyOne));
    const seen = new Set();
    const articles = [];
    for (const b of batches){
      for (const a of b){
        if (!a?.url || seen.has(a.url)) continue;
        seen.add(a.url);
        let domain = '';
        try { domain = new URL(a.url).hostname.replace(/^www\./,''); } catch(e){}
        articles.push({
          title: a.title || '',
          snippet: String(a.content || '').slice(0, 240),
          url: a.url,
          domain
        });
      }
    }
    if (!articles.length) return res.status(200).json({ ok: true, fetched: 0, written: 0, note: 'tavily empty' });

    const list = articles.slice(0, 50);

    // 2) Классификатор с failover
    const { sys, user } = buildPrompt(list);
    const { txt, via } = await classify(sys, user);
    let arr = safeJson(txt);
    if (!Array.isArray(arr)) arr = [];

    // 3) Гео + нормализация + дедуп
    const rows = arr.filter(o => o && o.ticker && o.url).map(o => {
      const g = GEO[o.country] || GEO['United States'];
      const sector = SECTORS.includes(o.sector) ? o.sector : 'Прочее';
      return {
        ticker: String(o.ticker).toUpperCase().slice(0, 10),
        company: o.company || null,
        sector,
        direction: ['bull','bear','neutral'].includes(o.direction) ? o.direction : 'neutral',
        impact: Math.max(0, Math.min(100, parseInt(o.impact) || 0)),
        lat: g[0], lng: g[1],
        country: o.country || null,
        headline: (o.headline || o.company || o.ticker || '').slice(0, 200),
        summary: null,
        url: o.url,
        url_hash: hash(o.url),
        source: 'tavily'
      };
    });

    // локальный дедуп по url_hash в рамках батча
    const uniq = []; const hs = new Set();
    for (const r of rows){ if (!hs.has(r.url_hash)){ hs.add(r.url_hash); uniq.push(r); } }

    if (!uniq.length) return res.status(200).json({ ok: true, fetched: list.length, classified: arr.length, written: 0, via });

    // 4) Supabase upsert (ignore-duplicates по url_hash)
    const up = await timedFetch(`${SUPABASE_URL}/rest/v1/signals?on_conflict=url_hash`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SECRET,
        'Authorization': `Bearer ${SUPABASE_SECRET}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates,return=minimal'
      },
      body: JSON.stringify(uniq)
    });

    if (!up.ok){
      const errText = await up.text().catch(() => '');
      return res.status(502).json({ ok: false, supabase_status: up.status, supabase_error: errText.slice(0, 300), via });
    }

    return res.status(200).json({ ok: true, fetched: list.length, classified: arr.length, written: uniq.length, via });
  } catch(e){
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
