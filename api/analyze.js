if (action === 'winescrape') {
  const fcKey = process.env.FIRECRAWL_KEY;
  if (!fcKey) return res.status(500).json({ error: 'No FIRECRAWL_KEY' });
  if (!crKey) return res.status(500).json({ error: 'No CRAZYROUTER_KEY' });

  const champagne = (query || '').trim();
  if (!champagne) return res.json({ wineshopper: [], winezone: [] });

  // Скрейп конкретной страницы. waitFor поднят до 6000 — winezone грузит каталог медленно.
  async function fcScrape(url) {
    try {
      const r = await fetch('https://api.firecrawl.dev/v2/scrape', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + fcKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, formats: ['markdown'], waitFor: 6000, proxy: 'auto' })
      });
      const d = await r.json();
      const data = d.data || d;
      return (data && data.markdown) ? data.markdown : '';
    } catch (e) { return ''; }
  }

  // Поиск по домену. КЛЮЧЕВОЕ: если выдача тонкая — скрейпим ПЕРВУЮ найденную
  // ссылку (это бренд-страница), а не общий каталог. Общий каталог — только крайний фолбэк.
  async function fcSearch(domain, fallbackUrl) {
    let out = '', topUrl = '';
    try {
      const r = await fetch('https://api.firecrawl.dev/v2/search', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + fcKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: champagne + ' купить цена',
          limit: 5,
          location: 'Russia',
          includeDomains: [domain],
          scrapeOptions: { formats: ['markdown'], waitFor: 6000, proxy: 'auto' }
        })
      });
      const d = await r.json();
      const web = (d.data && d.data.web) || d.web || [];
      out = web.map(x => (x.markdown || x.description || '')).join('\n\n---\n\n').slice(0, 12000);
      if (web.length && web[0].url) topUrl = web[0].url;   // ← ссылка из реальной выдачи
    } catch (e) {}
    if (!out || out.length < 120) {
      const target = topUrl || fallbackUrl;                // ← сначала найденная страница, потом каталог
      if (target) out = (await fcScrape(target)).slice(0, 12000);
    }
    return out;
  }

  const [wsRaw, wzRaw] = await Promise.all([
    fcSearch('wine-shopper.ru', null),
    fcSearch('winezone.ru', 'https://winezone.ru/shampanskoe')
  ]);

  const extractPrompt =
    'Ниже содержимое страниц двух винных магазинов по запросу "' + champagne + '".\n\n' +
    '=== WINE-SHOPPER.RU ===\n' + (wsRaw || 'нет данных') + '\n\n' +
    '=== WINEZONE.RU ===\n' + (wzRaw || 'нет данных') + '\n\n' +
    'Извлеки реальные товары с ценами в рублях ТОЛЬКО из текста выше. ' +
    'Бери только позиции, релевантные запросу "' + champagne + '" (тот же бренд). ' +
    'НЕ выдумывай ни названия, ни цены. Если по магазину релевантных данных нет — пустой массив. ' +
    'Ответь СТРОГО валидным JSON без markdown:\n' +
    '{"wineshopper":[{"name":"полное название","price":12345,"volume":"750 мл","type":"Brut"}],"winezone":[]}';

  let parsed = { wineshopper: [], winezone: [] };
  try {
    const text = await callClaude([{ role: 'user', content: extractPrompt }], 2000);
    const clean = (text || '').replace(/```json|```/g, '').trim();
    const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
    if (s !== -1 && e !== -1) parsed = JSON.parse(clean.slice(s, e + 1));
  } catch (e) {}

  if (!Array.isArray(parsed.wineshopper)) parsed.wineshopper = [];
  if (!Array.isArray(parsed.winezone)) parsed.winezone = [];

  // DEBUG включён намеренно — посмотри wzLen в ответе. Убери эту строку, когда WineZone заработает.
  parsed._debug = { wsLen: wsRaw.length, wzLen: wzRaw.length, ws: wsRaw.slice(0, 400), wz: wzRaw.slice(0, 400) };

  return res.json(parsed);
}
