// api/tavily-test.js — диагностика Tavily через Vercel. Удалить после проверки.
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const key = process.env.TAVILY_KEY || process.env.TAVILY_API_KEY || '';
  const q = (req.query && req.query.q) || 'TSMC Taiwan';

  const diag = {
    env_var_seen: process.env.TAVILY_KEY ? 'TAVILY_KEY' : (process.env.TAVILY_API_KEY ? 'TAVILY_API_KEY' : 'НЕ НАЙДЕН'),
    key_present: !!key,
    key_prefix_ok: key.startsWith('tvly-'),
    key_len: key.length,
    query: q
  };

  if (!key) {
    return res.status(200).json({ ...diag, verdict: '❌ ключа нет в ENV Vercel' });
  }

  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        query: q,
        search_depth: 'basic',
        max_results: 5
      })
    });

    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}

    const count = data?.results?.length ?? 0;

    return res.status(200).json({
      ...diag,
      http_status: r.status,
      results_count: count,
      first_title: data?.results?.[0]?.title || null,
      first_url: data?.results?.[0]?.url || null,
      verdict: r.status === 200 && count > 0
        ? '✅ Tavily через Vercel работает'
        : (r.status === 401 ? '❌ ключ невалиден (401)'
          : count === 0 ? '⚠️ статус 200, но 0 результатов — фильтры/тариф ключа'
          : `❌ статус ${r.status}`),
      raw_error: r.status !== 200 ? text.slice(0, 500) : undefined
    });
  } catch (e) {
    return res.status(200).json({ ...diag, verdict: '❌ сеть/исключение', error: String(e).slice(0, 300) });
  }
}
