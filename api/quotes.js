// api/quotes.js — STARK ГЛОБУС · котировки для бегущей ленты
// Батч-котировки FMP одним запросом. Лента сортируется по |изменение %| = «самые живые».
// FMP free = 250 запросов/сутки → фронт дёргает редко (на загрузке + раз в 15 мин).
// ESM, чистый JS. Yahoo не используем — он 429-ит с IP Vercel; FMP проходит.

export const config = { maxDuration: 15 };

const FMP = process.env.FMP_KEY || '';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (!FMP) return res.status(200).json({ ok: false, error: 'нет FMP_KEY', quotes: [] });

  const raw = String((req.query && req.query.tickers) || '').trim();
  if (!raw) return res.status(200).json({ ok: false, error: 'нет tickers', quotes: [] });

  const list = [...new Set(raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))].slice(0, 50);
  if (!list.length) return res.status(200).json({ ok: false, error: 'пустой список', quotes: [] });

  try {
    const url = `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(list.join(','))}?apikey=${FMP}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(200).json({ ok: false, error: 'FMP HTTP ' + r.status, quotes: [] });
    const j = await r.json();
    const quotes = (Array.isArray(j) ? j : [])
      .map(q => ({
        ticker: q.symbol,
        price: q.price,
        changePct: typeof q.changesPercentage === 'string' ? parseFloat(q.changesPercentage) : q.changesPercentage
      }))
      .filter(q => q.ticker && q.price != null);
    return res.status(200).json({ ok: true, count: quotes.length, quotes });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e.message || e).slice(0, 200), quotes: [] });
  }
}
