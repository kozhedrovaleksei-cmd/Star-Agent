// ════════════════════════════════════════════════════════════════
// stark_universe.js — членство + сектор по 4 файлам STARK (TV)
// quiet / hidden / mid  = КОМПАНИИ-ЦЕЛИ (на них садятся дуги глобуса)
// macro                 = ИНСТРУМЕНТЫ (фьючерсы/индексы/FX/ETF) = слой контекста, НЕ цели
// Сектор — из фикс-таксономии STARK. Тикеры без биржевого префикса.
// Pure ESM. Источник истины для: Рынок-вкладки (ротация по секторам),
// Analyzer (приоритет «своих» имён), резолвера (что геокодить).
// ════════════════════════════════════════════════════════════════

// t(ticker, sector, ...tiers)
const U = {};
const t = (tk, sector, ...tiers) => {
  if (U[tk]) {
    U[tk].tiers = [...new Set([...U[tk].tiers, ...tiers])];
    if (!U[tk].sector) U[tk].sector = sector;
  } else {
    U[tk] = { sector, tiers };
  }
};

// ── QUIET (защитные, beta<0.8) ──────────────────────────────────
['TRV','CB','ALL','PGR','CINF','WRB','CME','HIG','ACGL','AFL','MMC','AON','AJG','BRO','GL','AIG','MET','L']
  .forEach(x => t(x, 'Финансы', 'quiet'));
['KO','PEP','PG','CL','KMB','CHD','CLX','GIS','HSY','MKC','K','MDLZ','KHC','KDP','KVUE','HRL','CAG','CPB','SJM','SYY','KR','MO','PM','ADM','TSN','MCD','AZO','ORLY','YUM']
  .forEach(x => t(x, 'Потребительский', 'quiet'));
['DUK','SO','D','AEP','XEL','WEC','ED','EXC','PEG','ES','FE','CMS','DTE','AEE','ATO','LNT','NI','CNP','EVRG','PNW','SRE','PPL','XOM','CVX','COP','KMI','WMB','OKE']
  .forEach(x => t(x, 'Энергетика', 'quiet'));
['VZ','T'].forEach(x => t(x, 'Медиа/Комм', 'quiet'));
['JNJ','MRK','BMY','GILD','PFE','ABBV','AMGN','CI','HUM','MCK','COR','CAH','DGX','LH','ABT','BDX','MDT']
  .forEach(x => t(x, 'Здравоохранение', 'quiet'));
['LMT','NOC','GD','RTX','HII','LHX'].forEach(x => t(x, 'Оборона/Аэрокосмос', 'quiet'));
['WM','RSG','HON'].forEach(x => t(x, 'Промышленность', 'quiet'));
['O','PSA','VICI','AMT','WELL'].forEach(x => t(x, 'Прочее', 'quiet'));   // REIT — нет буфера в таксономии

// ── HIDDEN 50 (под радаром, низкая волатильность) ───────────────
['RLI','AFG','ORI','MKL','ERIE','RGA','SIGI','AIZ'].forEach(x => t(x, 'Финансы', 'hidden'));
['IDA','OGE','POR','NWE','BKH','OTTR','NJR','MGEE','EPD','MPLX','WES','DTM'].forEach(x => t(x, 'Энергетика', 'hidden'));
['LANC','FLO','INGR','POST','EPC','CENTA'].forEach(x => t(x, 'Потребительский', 'hidden'));
['CHE','EHC','ENSG','DVA','HSIC','PINC','RMD'].forEach(x => t(x, 'Здравоохранение', 'hidden'));
['ROL','BR','JKHY','FDS','POOL','DCI','UNF','EXPD','ABM','MSA'].forEach(x => t(x, 'Промышленность', 'hidden'));
['WPC','NNN','ADC','FRT','ELS','CUBE','OHI'].forEach(x => t(x, 'Прочее', 'hidden'));

// ── MID (beta 0.9–1.4) ──────────────────────────────────────────
['JPM','GS','MS','BAC','V','MA','AXP','SCHW'].forEach(x => t(x, 'Финансы', 'mid'));
['CAT','DE','GE','UNP','ETN','FDX','UPS'].forEach(x => t(x, 'Промышленность', 'mid'));
['BA','LMT','RTX'].forEach(x => t(x, 'Оборона/Аэрокосмос', 'mid'));
['NKE','SBUX','MCD','HD','LOW','CMG','UBER','ABNB','BKNG'].forEach(x => t(x, 'Потребительский', 'mid'));
['AAPL','MSFT','GOOGL','META','ADBE','CRM','ORCL','ACN','IBM'].forEach(x => t(x, 'Мега-тех', 'mid'));
['QCOM'].forEach(x => t(x, 'Полупроводники/AI', 'mid'));
['NFLX'].forEach(x => t(x, 'Медиа/Комм', 'mid'));
['LLY','UNH','ISRG','TMO','DHR','ABBV'].forEach(x => t(x, 'Здравоохранение', 'mid'));
['XOM','CVX','COP','SLB'].forEach(x => t(x, 'Энергетика', 'mid'));
['FCX','NUE'].forEach(x => t(x, 'Промышленность', 'mid'));

// ── Реальные акции из macro-файла (остальное — инструменты, ниже) ─
['AA','ALB'].forEach(x => t(x, 'Промышленность', 'macro'));
['COIN','MSTR'].forEach(x => t(x, 'Крипто', 'macro'));

export const UNIVERSE = U;                       // { ticker: { sector, tiers:[...] } }
export const TICKERS  = Object.keys(U);

// быстрые срезы
export const bySector = (s) => TICKERS.filter(tk => U[tk].sector === s);
export const byTier   = (tier) => TICKERS.filter(tk => U[tk].tiers.includes(tier));
export const sectorOf = (tk) => U[tk?.toUpperCase()]?.sector || null;
export const isOurs   = (tk) => !!U[tk?.toUpperCase()];

// ── MACRO = слой контекста (НЕ цели глобуса, НЕ геокодить) ───────
// Скармливается режим-синтезатору, не Analyzer-у дуг.
export const MACRO_INSTRUMENTS = {
  'Нефть/газ':      ['USOIL','UKOIL','NG','USO','UNG','XLE','XOP'],
  'Уран/ядерное':   ['URA','CCJ','URNM','URNJ'],
  'Драгметаллы':    ['GOLD','SILVER','PLATINUM','PALLADIUM','GLD','SLV','GDX'],
  'Пром.металлы':   ['HG','COPX','XME'],            // FCX/NUE/AA/ALB вынесены в компании
  'Агро/сырьё':     ['ZC','ZW','ZS','DBC','DBA'],
  'US индексы':     ['SPX','NDX','DJI','RUT','SPY','QQQ','IWM','DIA'],
  'EU индексы':     ['DEU40','FRA40','UK100','SX5E','ES35','IT40'],
  'Asia индексы':   ['NI225','HSI','SSEC','KOSPI','SENSEX','TWII','AUS200'],
  'Доходности':     ['US03MY','US02Y','US10Y','US30Y','DE10Y','JP10Y','GB10Y','CN10Y'],
  'Облигации ETF':  ['TLT','IEF','SHY','TIP','AGG','HYG','LQD','JNK','EMB'],
  'Волатильность':  ['VIX','VIX3M','VVIX','VXN','SKEW','MOVE'],
  'Валюты':         ['DXY','EURUSD','USDJPY','GBPUSD','USDCNH','AUDUSD','USDCHF','USDRUB'],
  'Сектора US':     ['XLF','XLK','XLU','XLV','XLI','XLP','XLY','XLB','XLRE','XLC','SMH','KRE','ITB'],
  'Транспорт/цикл': ['IYT','DJT','BOAT'],
  'Крипто-прокси':  ['BTCUSD','ETHUSD']             // COIN/MSTR вынесены в компании
};
