// ════════════════════════════════════════════════════════════════
// api/universe-geo.js — отдаёт фронту-глобусу полный юниверс STARK
// с координатами HQ. Источник истины тикеров = lib/stark_universe.js.
// Координаты ставит resolveHQ (override → supply → geo_cache → FMP),
// LLM НЕ участвует — чистая код-география. Результат кешируется в
// Supabase geo_cache (общий с globe-scan) + edge-cache 24ч.
// Pure ESM. GET /api/universe-geo
// ════════════════════════════════════════════════════════════════
import { UNIVERSE, sectorOf } from '../lib/stark_universe.js';
import { resolveHQ } from '../lib/geo_resolve.js';

export const config = { maxDuration: 180 };

const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;   // service_role
const FMP_KEY         = process.env.FMP_KEY;

// ── Supabase geo_cache wrapper (общий с globe-scan) ─────────────
// Схема (SQL под кодом). Ошибки кеша безопасны: resolveHQ глотает их
// в try/catch → фолбэк на FMP.
function makeGeoCache() {
  if (!SUPABASE_URL || !SUPABASE_SECRET) return null;
  const base = `${SUPABASE_URL}/rest/v1/geo_cache`;
  const headers = {
    apikey: SUPABASE_SECRET,
    Authorization: `Bearer ${SUPABASE_SECRET}`,
    'Content-Type': 'application/json'
  };
  return {
    async get(ticker) {
      const r = await fetch(
        `${base}?ticker=eq.${encodeURIComponent(ticker)}&select=lat,lng,country,city,level`,
        { headers }
      );
      if (!r.ok) return null;
      const rows = await r.json();
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row || row.lat == null || row.lng == null) return null;
      return { lat: row.lat, lng: row.lng, country: row.country, city: row.city, level: row.level };
    },
    async set(ticker, geo) {
      await fetch(base, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          ticker,
          lat: geo.lat, lng: geo.lng,
          country: geo.country ?? null,
          city: geo.city ?? null,
          level: geo.level ?? null,
          updated_at: new Date().toISOString()
        })
      });
    }
  };
}

// ── Пул с ограничением конкурентности (FMP не захлёбывается) ────
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

export default async function handler(req, res) {
  try {
    const cache   = makeGeoCache();
    const tickers = Object.keys(UNIVERSE);

    const resolved = await mapPool(tickers, 8, async (tk) => {
      const hq = await resolveHQ(tk, { fmpKey: FMP_KEY, cache });
      if (!hq) return null;
      return {
        ticker:  tk,
        name:    tk,                          // имя компании = отдельный ход enrich
        sector:  sectorOf(tk) || 'Прочее',
        hq_lat:  hq.lat,
        hq_lng:  hq.lng,
        city:    hq.city    || null,          // реальный город из FMP/supply (override → null)
        country: hq.country || null,
        level:   hq.level   || null           // override|supply|cache|state|country|fallback
      };
    });

    const points = resolved.filter(Boolean);

    // edge-cache 24ч: на каждый холодный старт FMP не дёргается
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=43200');
    res.status(200).json({
      ok: true,
      count: points.length,
      generated_at: new Date().toISOString(),
      points
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
