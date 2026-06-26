// ════════════════════════════════════════════════════════════════
// geo_resolve.js — координаты для дуг глобуса (origin страна → HQ цели)
// Принцип: НИЧЕГО не выдумываем. Координаты стран/штатов — публичная
// гео-фактура. HQ компаний — либо override (крупняк, мгновенно),
// либо резолвер через FMP (реальный город/страна), результат кешируется.
// Тикер вне списков → FMP отдаёт реальную локацию, не догадку.
// Pure ESM.
// ════════════════════════════════════════════════════════════════

// ── Центроиды стран (ISO2, под формат FMP profile.country) ──────
export const COUNTRY = {
  US:[39.8,-98.6], TW:[23.7,121.0], CN:[35.0,103.0], JP:[36.2,138.3], KR:[36.5,127.8],
  NL:[52.1,5.3],   DE:[51.2,10.4],  FR:[46.6,2.2],   GB:[54.0,-2.0],  IE:[53.4,-8.0],
  CH:[46.8,8.2],   IT:[41.9,12.6],  ES:[40.0,-3.7],  CA:[56.1,-106.3],MX:[23.6,-102.5],
  BR:[-14.2,-51.9],IN:[20.6,79.0],  AU:[-25.3,133.8],SA:[23.9,45.1],  AE:[23.4,53.8],
  RU:[61.5,105.3], ID:[-0.8,113.9], CL:[-35.7,-71.5],PE:[-9.2,-75.0], SG:[1.35,103.8],
  HK:[22.3,114.2], NO:[60.5,8.5],   SE:[60.1,18.6],  DK:[56.3,9.5],   IL:[31.0,34.8],
  TR:[39.0,35.2],  ZA:[-30.6,22.9], NG:[9.1,8.7],    AR:[-38.4,-63.6],QA:[25.4,51.2],
  KW:[29.3,47.5],  VN:[14.1,108.3], TH:[15.9,100.9], MY:[4.2,101.9],  PH:[12.9,121.8]
};

// ── Центроиды штатов US (под formato FMP profile.state = 2 буквы) ─
export const US_STATE = {
  AL:[32.8,-86.8],AK:[64.0,-152.0],AZ:[34.2,-111.7],AR:[34.9,-92.4],CA:[37.2,-119.4],
  CO:[39.0,-105.5],CT:[41.6,-72.7],DE:[39.0,-75.5],FL:[28.6,-82.4],GA:[32.6,-83.4],
  HI:[20.3,-156.4],ID:[44.4,-114.6],IL:[40.0,-89.2],IN:[39.9,-86.3],IA:[42.0,-93.5],
  KS:[38.5,-98.4],KY:[37.5,-85.3],LA:[31.0,-92.0],ME:[45.4,-69.2],MD:[39.0,-76.8],
  MA:[42.3,-71.8],MI:[44.3,-85.4],MN:[46.3,-94.3],MS:[32.7,-89.7],MO:[38.4,-92.5],
  MT:[47.0,-109.6],NE:[41.5,-99.8],NV:[39.3,-116.6],NH:[43.7,-71.6],NJ:[40.1,-74.7],
  NM:[34.4,-106.1],NY:[42.9,-75.5],NC:[35.5,-79.4],ND:[47.5,-100.5],OH:[40.3,-82.8],
  OK:[35.6,-97.5],OR:[44.0,-120.5],PA:[40.9,-77.8],RI:[41.7,-71.6],SC:[33.9,-80.9],
  SD:[44.4,-100.2],TN:[35.9,-86.4],TX:[31.5,-99.3],UT:[39.3,-111.7],VT:[44.1,-72.7],
  VA:[37.5,-78.9],WA:[47.4,-120.5],WV:[38.6,-80.6],WI:[44.6,-89.9],WY:[43.0,-107.6],
  DC:[38.9,-77.0]
};

// ── Иностранные supply-nodes (частые цели/origin, нет в юниверсе) ─
export const SUPPLY_NODES = {
  TSM:[24.77,121.0,'TW','Hsinchu'],  ASML:[51.41,5.45,'NL','Veldhoven'],
  SSNLF:[37.40,127.11,'KR','Suwon'], HNHPF:[24.95,121.37,'TW','Tucheng'],   // Foxconn
  SONY:[35.63,139.74,'JP','Tokyo'],  TM:[35.08,137.16,'JP','Toyota City'],
  SAP:[49.29,8.64,'DE','Walldorf'],  NVO:[55.73,12.46,'DK','Bagsvaerd'],
  SHEL:[51.50,-0.12,'GB','London'],  BABA:[30.29,120.08,'CN','Hangzhou'],
  BP:[51.50,-0.13,'GB','London'],    NSRGY:[46.46,6.84,'CH','Vevey']        // Nestle
};

// ── Override: крупняк, мгновенно без FMP (HQ-метро, стабильно) ───
export const HQ_OVERRIDE = {
  AAPL:[37.33,-122.03,'US'], MSFT:[47.64,-122.13,'US'], GOOGL:[37.42,-122.08,'US'],
  META:[37.48,-122.15,'US'], NVDA:[37.37,-121.96,'US'], AMD:[37.41,-121.94,'US'],
  JPM:[40.75,-73.98,'US'],   GS:[40.71,-74.01,'US'],    MS:[40.71,-74.01,'US'],
  BAC:[35.22,-80.84,'US'],   V:[37.55,-122.28,'US'],    MA:[41.04,-73.72,'US'],
  AXP:[40.71,-74.01,'US'],   SCHW:[32.99,-97.20,'US'],
  KO:[33.76,-84.39,'US'],    PEP:[41.04,-73.72,'US'],   PG:[39.10,-84.51,'US'],
  XOM:[30.08,-95.42,'US'],   CVX:[37.78,-121.96,'US'],  COP:[29.76,-95.37,'US'],
  SLB:[29.76,-95.37,'US'],   FCX:[33.45,-112.07,'US'],  NUE:[35.22,-80.84,'US'],
  JNJ:[40.49,-74.45,'US'],   LLY:[39.77,-86.16,'US'],   UNH:[44.94,-93.46,'US'],
  PFE:[40.75,-73.97,'US'],   MRK:[40.62,-74.28,'US'],   ABBV:[42.32,-87.84,'US'],
  TMO:[42.39,-71.24,'US'],   DHR:[38.90,-77.04,'US'],   ISRG:[37.39,-122.03,'US'],
  HD:[33.84,-84.36,'US'],    LOW:[35.58,-80.85,'US'],   MCD:[41.88,-87.63,'US'],
  NKE:[45.51,-122.84,'US'],  SBUX:[47.58,-122.34,'US'], CMG:[33.62,-117.93,'US'],
  UBER:[37.77,-122.41,'US'], ABNB:[37.77,-122.41,'US'], BKNG:[41.12,-73.42,'US'],
  LMT:[38.98,-77.10,'US'],   RTX:[38.88,-77.10,'US'],   BA:[38.88,-77.10,'US'],
  NOC:[38.88,-77.17,'US'],   GD:[38.88,-77.17,'US'],
  CAT:[32.81,-96.94,'US'],   DE:[41.51,-90.52,'US'],    GE:[42.36,-71.06,'US'],
  UNP:[41.26,-95.94,'US'],   ETN:[53.34,-6.26,'IE'],    // Eaton — юр. Ирландия
  ACN:[53.34,-6.26,'IE'],                               // Accenture — Дублин
  IBM:[41.11,-73.72,'US'],   ORCL:[30.27,-97.74,'US'],  CRM:[37.79,-122.40,'US'],
  ADBE:[37.33,-121.89,'US'], QCOM:[32.90,-117.20,'US'], NFLX:[37.23,-121.96,'US'],
  FDX:[35.12,-89.97,'US'],   UPS:[33.79,-84.32,'US'],   VZ:[40.75,-73.98,'US'],
  T:[32.78,-96.80,'US'],     PM:[41.05,-73.54,'US'],    MO:[37.54,-77.46,'US']
};

const norm = (s) => (s || '').toString().trim().toUpperCase();

// Город/штат/страна из FMP-профиля → координаты (без внешнего геокодера)
function geoFromProfile(p) {
  const country = norm(p.country);
  const state   = norm(p.state);
  if (country === 'US' && US_STATE[state]) {
    const [lat, lng] = US_STATE[state];
    return { lat, lng, country: 'US', city: p.city || null, level: 'state' };
  }
  if (COUNTRY[country]) {
    const [lat, lng] = COUNTRY[country];
    return { lat, lng, country, city: p.city || null, level: 'country' };
  }
  const [lat, lng] = COUNTRY.US;                         // последний фолбэк
  return { lat, lng, country: country || 'US', city: p.city || null, level: 'fallback' };
}

// ── Главный резолвер ────────────────────────────────────────────
// cache: опционально { get(ticker), set(ticker, obj) } — повесь на Supabase geo_cache
export async function resolveHQ(ticker, { fmpKey, cache } = {}) {
  const t = norm(ticker);
  if (!t) return null;

  if (HQ_OVERRIDE[t])   { const [lat,lng,c]=HQ_OVERRIDE[t];   return { lat,lng,country:c,city:null,level:'override',source:'override' }; }
  if (SUPPLY_NODES[t])  { const [lat,lng,c,city]=SUPPLY_NODES[t]; return { lat,lng,country:c,city,level:'supply',source:'supply' }; }

  if (cache?.get) {
    try { const c = await cache.get(t); if (c) return { ...c, source: 'cache' }; } catch {}
  }
  if (!fmpKey) { const [lat,lng]=COUNTRY.US; return { lat,lng,country:'US',city:null,level:'fallback',source:'no-key' }; }

  try {
    const r = await fetch(`https://financialmodelingprep.com/api/v3/profile/${t}?apikey=${fmpKey}`);
    const arr = await r.json();
    const p = Array.isArray(arr) ? arr[0] : null;
    if (!p) throw new Error('empty profile');
    const geo = geoFromProfile(p);
    if (cache?.set) { try { await cache.set(t, geo); } catch {} }
    return { ...geo, source: 'fmp' };
  } catch {
    const [lat,lng]=COUNTRY.US; return { lat,lng,country:'US',city:null,level:'fallback',source:'fmp-fail' };
  }
}

// Origin (страна события) → координаты. Имя страны RU/EN/ISO → центроид.
const COUNTRY_ALIASES = {
  'TAIWAN':'TW','ТАЙВАНЬ':'TW','CHINA':'CN','КИТАЙ':'CN','JAPAN':'JP','ЯПОНИЯ':'JP',
  'SOUTH KOREA':'KR','КОРЕЯ':'KR','NETHERLANDS':'NL','НИДЕРЛАНДЫ':'NL','GERMANY':'DE','ГЕРМАНИЯ':'DE',
  'USA':'US','UNITED STATES':'US','США':'US','UK':'GB','UNITED KINGDOM':'GB','БРИТАНИЯ':'GB',
  'CHILE':'CL','ЧИЛИ':'CL','AUSTRALIA':'AU','АВСТРАЛИЯ':'AU','INDONESIA':'ID','ИНДОНЕЗИЯ':'ID',
  'SAUDI ARABIA':'SA','RUSSIA':'RU','РОССИЯ':'RU','INDIA':'IN','ИНДИЯ':'IN','PERU':'PE','ПЕРУ':'PE'
};
export function originCoords(countryNameOrIso) {
  const k = norm(countryNameOrIso);
  const iso = COUNTRY[k] ? k : (COUNTRY_ALIASES[k] || null);
  if (iso && COUNTRY[iso]) { const [lat,lng]=COUNTRY[iso]; return { lat, lng, iso }; }
  return null;   // не нашли — пусть Analyzer вернёт lat/lng сам
}
