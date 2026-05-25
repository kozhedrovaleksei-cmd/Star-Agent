<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>STARK AI AGENT</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@300;400;600&display=swap');

* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --gold: #C9A84C;
  --gold2: #E8C96B;
  --red: #E05252;
  --green: #4CAF7D;
  --bg: #080808;
  --bg2: #0F0F0F;
  --bg3: #161616;
  --border: #222;
  --text: #E0E0E0;
  --dim: #666;
}

body { background: var(--bg); color: var(--text); font-family: 'JetBrains Mono', monospace; min-height: 100vh; }

.hdr {
  padding: 24px 32px 20px;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
  background: linear-gradient(135deg, #080800 0%, #080808 100%);
}
.hdr-logo { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 4px; color: var(--gold); }
.hdr-sub { font-size: 10px; color: var(--dim); letter-spacing: 2px; }
.status-dot { width: 8px; height: 8px; background: var(--green); border-radius: 50%; animation: pulse 2s infinite; display: inline-block; margin-right: 6px; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
.status-text { font-size: 10px; color: var(--green); letter-spacing: 2px; }

.keys-section { padding: 16px 32px; background: var(--bg2); border-bottom: 1px solid var(--border); }
.keys-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
.key-label { font-size: 10px; color: var(--dim); letter-spacing: 2px; white-space: nowrap; min-width: 160px; }
.key-input {
  flex: 1; min-width: 200px;
  background: var(--bg3); border: 1px solid var(--border);
  color: var(--text); font-family: 'JetBrains Mono', monospace; font-size: 12px;
  padding: 8px 12px; border-radius: 3px; outline: none;
}
.key-input:focus { border-color: var(--gold); }
.key-btn {
  background: var(--gold); color: #000; border: none;
  font-family: 'Bebas Neue', sans-serif; font-size: 14px; letter-spacing: 2px;
  padding: 8px 20px; border-radius: 3px; cursor: pointer; white-space: nowrap;
}
.key-btn:hover { background: var(--gold2); }
.key-status { font-size: 11px; }

.main { padding: 24px 32px; max-width: 1200px; }

.input-row { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.ticker-wrap { flex: 0 0 140px; }
.ticker-label, .hypo-label { font-size: 10px; color: var(--dim); letter-spacing: 2px; margin-bottom: 6px; }
.ticker-input {
  width: 100%; background: var(--bg2); border: 1px solid var(--gold);
  color: var(--gold); font-family: 'Bebas Neue', sans-serif; font-size: 28px;
  letter-spacing: 3px; padding: 10px 14px; border-radius: 3px; outline: none; text-transform: uppercase;
}
.hypo-wrap { flex: 1; min-width: 200px; }
.hypo-input {
  width: 100%; background: var(--bg2); border: 1px solid var(--border);
  color: var(--text); font-family: 'JetBrains Mono', monospace; font-size: 12px;
  padding: 10px 14px; border-radius: 3px; outline: none; resize: none; height: 62px;
}
.hypo-input:focus { border-color: var(--gold); }
.analyze-btn {
  flex: 0 0 180px; background: linear-gradient(135deg, var(--gold) 0%, #8B6914 100%);
  color: #000; border: none; font-family: 'Bebas Neue', sans-serif; font-size: 20px;
  letter-spacing: 3px; border-radius: 3px; cursor: pointer; align-self: flex-end; height: 62px;
}
.analyze-btn:hover { opacity: 0.9; }
.analyze-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.quick { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
.q-btn {
  background: var(--bg3); border: 1px solid var(--border); color: var(--dim);
  font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 5px 10px;
  border-radius: 3px; cursor: pointer; letter-spacing: 1px;
}
.q-btn:hover { border-color: var(--gold); color: var(--gold); }

.loading { display: none; padding: 32px; text-align: center; }
.loading.show { display: block; }
.load-title { font-family: 'Bebas Neue', sans-serif; font-size: 20px; letter-spacing: 3px; color: var(--gold); margin-bottom: 20px; }
.steps { display: flex; flex-direction: column; gap: 8px; max-width: 420px; margin: 0 auto; }
.step {
  display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--dim);
  padding: 8px 12px; border: 1px solid var(--border); border-radius: 3px;
  background: var(--bg2); transition: all 0.3s;
}
.step.active { color: var(--gold); border-color: var(--gold); }
.step.done { color: var(--green); border-color: var(--green); }

.error-box {
  display: none; background: rgba(224,82,82,0.1); border: 1px solid var(--red);
  border-radius: 3px; padding: 12px 16px; margin-bottom: 16px; font-size: 12px; color: var(--red);
}
.error-box.show { display: block; }

.result { display: none; }
.result.show { display: block; }

.stock-hdr { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 16px; }
.stock-name { font-family: 'Bebas Neue', sans-serif; font-size: 52px; color: var(--gold); letter-spacing: 4px; line-height: 1; }
.stock-full { font-size: 12px; color: var(--dim); margin-top: 4px; }
.stock-sector { display: inline-block; background: rgba(201,168,76,0.1); border: 1px solid var(--gold); color: var(--gold); font-size: 10px; padding: 3px 8px; border-radius: 2px; margin-top: 6px; letter-spacing: 1px; }
.stock-price-block { text-align: right; }
.stock-price { font-family: 'Bebas Neue', sans-serif; font-size: 42px; color: var(--text); line-height: 1; }
.stock-change { font-size: 13px; margin-top: 4px; }
.pos { color: var(--green); } .neg { color: var(--red); }
.verdict-badge { display: inline-block; font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 3px; padding: 8px 20px; border-radius: 3px; margin-top: 8px; }
.verdict-buy { background: var(--green); color: #000; }
.verdict-watch { background: #F5A623; color: #000; }
.verdict-wait { background: var(--dim); color: #000; }
.verdict-sell { background: var(--red); color: #fff; }

.web-data { background: rgba(76,175,125,0.05); border: 1px solid rgba(76,175,125,0.2); border-radius: 3px; padding: 12px 16px; margin-bottom: 16px; }
.web-data-title { font-size: 10px; color: var(--green); letter-spacing: 2px; margin-bottom: 8px; }
.web-data-text { font-size: 11px; color: var(--text); line-height: 1.6; }

.metrics { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; margin-bottom: 20px; }
.metric { background: var(--bg2); border: 1px solid var(--border); border-radius: 3px; padding: 12px; text-align: center; }
.metric-label { font-size: 9px; color: var(--dim); letter-spacing: 2px; margin-bottom: 4px; }
.metric-val { font-family: 'Bebas Neue', sans-serif; font-size: 20px; color: var(--text); }

.price-bar { margin-bottom: 20px; background: var(--bg2); border: 1px solid var(--border); border-radius: 3px; padding: 16px; }
.bar-title { font-size: 10px; color: var(--dim); letter-spacing: 2px; margin-bottom: 12px; }
.bar-track { height: 6px; background: var(--border); border-radius: 3px; position: relative; margin: 8px 0 20px; }
.bar-fill { height: 100%; background: linear-gradient(90deg, var(--red), var(--gold), var(--green)); border-radius: 3px; }
.bar-marker { position: absolute; top: -4px; width: 14px; height: 14px; background: var(--text); border: 2px solid var(--bg); border-radius: 50%; transform: translateX(-50%); }
.bar-labels { display: flex; justify-content: space-between; font-size: 10px; color: var(--dim); }
.levels-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 12px; }
.level-item { text-align: center; padding: 8px; border: 1px solid var(--border); border-radius: 3px; }
.level-label { font-size: 9px; color: var(--dim); letter-spacing: 1px; }
.level-val { font-family: 'Bebas Neue', sans-serif; font-size: 18px; margin-top: 2px; }
.lvl-sup { color: var(--red); } .lvl-entry { color: var(--gold); } .lvl-res { color: var(--green); }

.targets { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px; }
.target { background: var(--bg2); border: 1px solid var(--border); border-radius: 3px; padding: 14px; text-align: center; }
.target-label { font-size: 9px; color: var(--dim); letter-spacing: 2px; margin-bottom: 6px; }
.target-price { font-family: 'Bebas Neue', sans-serif; font-size: 24px; color: var(--green); }
.target-pct { font-size: 11px; color: var(--green); margin-top: 2px; }
.target-period { font-size: 10px; color: var(--dim); margin-top: 2px; }

.corr-section, .insiders-section, .events-section { background: var(--bg2); border: 1px solid var(--border); border-radius: 3px; padding: 16px; margin-bottom: 16px; }
.corr-title, .insiders-title, .events-title { font-size: 10px; color: var(--gold); letter-spacing: 2px; margin-bottom: 12px; }
.corr-text { font-size: 12px; color: var(--text); line-height: 1.7; margin-bottom: 12px; }
.corr-chain { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.corr-node { background: rgba(201,168,76,0.1); border: 1px solid rgba(201,168,76,0.3); color: var(--gold); font-size: 10px; padding: 4px 8px; border-radius: 2px; }
.corr-arrow { color: var(--dim); font-size: 12px; }

.insider-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; gap: 8px; }
.insider-item:last-child { border-bottom: none; }
.insider-name { font-size: 12px; color: var(--text); }
.insider-role { font-size: 10px; color: var(--dim); }
.insider-amount { font-family: 'Bebas Neue', sans-serif; font-size: 16px; }
.insider-buy { color: var(--green); } .insider-sell { color: var(--red); }
.insider-date { font-size: 10px; color: var(--dim); }

.event-item { display: flex; gap: 12px; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid var(--border); }
.event-item:last-child { border-bottom: none; }
.event-date { font-size: 10px; color: var(--dim); white-space: nowrap; min-width: 80px; }
.event-text { font-size: 12px; color: var(--text); line-height: 1.5; }
.event-tag { display: inline-block; font-size: 9px; padding: 2px 6px; border-radius: 2px; margin-left: 6px; }
.tag-urgent { background: rgba(224,82,82,0.2); color: var(--red); border: 1px solid rgba(224,82,82,0.3); }
.tag-catalyst { background: rgba(201,168,76,0.15); color: var(--gold); border: 1px solid rgba(201,168,76,0.3); }

.cases { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
.case-item { background: var(--bg2); border: 1px solid var(--border); border-radius: 3px; padding: 14px; }
.case-title { font-size: 10px; letter-spacing: 2px; margin-bottom: 8px; }
.bull { color: var(--green); } .bear { color: var(--red); }
.case-text { font-size: 11px; color: var(--text); line-height: 1.7; }

.verdict-section { background: linear-gradient(135deg, #0D0D00 0%, #080808 100%); border: 1px solid var(--gold); border-radius: 3px; padding: 20px; margin-bottom: 20px; }
.verdict-title { font-family: 'Bebas Neue', sans-serif; font-size: 14px; letter-spacing: 3px; color: var(--gold); margin-bottom: 12px; }
.verdict-text { font-size: 12px; color: var(--text); line-height: 1.8; }
.verdict-phrase { margin-top: 16px; font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 4px; color: var(--gold); }
.chart-section { background: var(--bg2); border: 1px solid var(--border); border-radius: 3px; padding: 16px; margin-bottom: 16px; }
.chart-title { font-size: 10px; color: var(--gold); letter-spacing: 2px; margin-bottom: 16px; }
.chart-wrap { position: relative; width: 100%; height: 300px; }
.chart-tooltip { position: absolute; background: var(--bg3); border: 1px solid var(--gold); border-radius: 3px; padding: 10px 14px; pointer-events: none; display: none; z-index: 10; max-width: 240px; line-height: 1.6; }
.tt-date { color: var(--gold); font-size: 10px; letter-spacing: 1px; margin-bottom: 4px; }
.tt-price { font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: var(--text); }
.tt-driver { color: var(--text); font-size: 11px; margin-top: 4px; }
.chart-events-list { margin-top: 16px; display: flex; flex-direction: column; gap: 6px; }
.chart-event-item { display: flex; gap: 10px; align-items: flex-start; font-size: 11px; padding: 6px 0; border-bottom: 1px solid var(--border); }
.chart-event-item:last-child { border-bottom: none; }
.ev-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; margin-top: 2px; }
.ev-peak { background: var(--gold); } .ev-crash { background: var(--red); } .ev-catalyst { background: var(--green); } .ev-current { background: #4A9EFF; }
.ev-date { color: var(--dim); min-width: 60px; } .ev-label { color: var(--gold); min-width: 80px; } .ev-driver { color: var(--text); flex: 1; }
</style>
</head>
<body>

<div class="hdr">
  <div>
    <div class="hdr-logo">STARK AI AGENT</div>
    <div class="hdr-sub">8-УРОВНЕВЫЙ АЛГОРИТМ · ИНСАЙДЕРЫ · ВЕБ-ПОИСК · МЕТОД АЛЕКСЕЯ · POWERED BY CLAUDE</div>
  </div>
  <div><span class="status-dot"></span><span class="status-text">AGENT ONLINE</span></div>
</div>

<div class="keys-section">
  <div class="keys-row">
    <span class="key-label">▼ CRAZYROUTER API KEY</span>
    <input type="password" id="crKeyInput" class="key-input" placeholder="sk-xxxxxxxxxxxxxxxx">
    <button class="key-btn" onclick="saveCRKey()">СОХРАНИТЬ</button>
    <span id="crKeyStatus" class="key-status"></span>
  </div>
  <div class="keys-row">
    <span class="key-label">▼ TAVILY API KEY (веб-поиск)</span>
    <input type="password" id="tvKeyInput" class="key-input" placeholder="tvly-xxxxxxxxxxxxxxxx">
    <button class="key-btn" onclick="saveTVKey()">СОХРАНИТЬ</button>
    <span id="tvKeyStatus" class="key-status"></span>
  </div>
</div>

<div class="main">
  <div class="input-row">
    <div class="ticker-wrap">
      <div class="ticker-label">ТИКЕР</div>
      <input type="text" id="tickerInput" class="ticker-input" placeholder="NKE" maxlength="6">
    </div>
    <div class="hypo-wrap">
      <div class="hypo-label">ТВОЯ ГИПОТЕЗА (необязательно)</div>
      <textarea id="contextInput" class="hypo-input" placeholder="Например: вижу корреляцию с нефтью, компания на дне цикла..."></textarea>
    </div>
    <button class="analyze-btn" id="analyzeBtn" onclick="analyze()">⚡ АНАЛИЗИРОВАТЬ</button>
  </div>

  <div class="quick">
    <span style="font-size:10px;color:var(--dim);letter-spacing:2px;align-self:center;">БЫСТРЫЙ ВЫБОР:</span>
    <button class="q-btn" onclick="setTicker('NKE')">NKE</button>
    <button class="q-btn" onclick="setTicker('CCJ')">CCJ</button>
    <button class="q-btn" onclick="setTicker('CEG')">CEG</button>
    <button class="q-btn" onclick="setTicker('PBR')">PBR</button>
    <button class="q-btn" onclick="setTicker('VST')">VST</button>
    <button class="q-btn" onclick="setTicker('OKLO')">OKLO</button>
    <button class="q-btn" onclick="setTicker('NOK')">NOK</button>
    <button class="q-btn" onclick="setTicker('FCX')">FCX</button>
    <button class="q-btn" onclick="setTicker('RKLB')">RKLB</button>
    <button class="q-btn" onclick="setTicker('SBER')">SBER</button>
    <button class="q-btn" onclick="setTicker('SVCB')">SVCB</button>
    <button class="q-btn" onclick="setTicker('FLNC')">FLNC</button>
  </div>

  <div id="errorBox" class="error-box"></div>

  <div id="loading" class="loading">
    <div class="load-title">⚡ STARK АНАЛИЗИРУЕТ...</div>
    <div class="steps">
      <div class="step" id="s1"><span>🌐</span> Веб-поиск актуальных данных</div>
      <div class="step" id="s2"><span>📰</span> Поиск новостей и инсайдеров</div>
      <div class="step" id="s3"><span>🔗</span> Скрытые корреляции и лаговые зависимости</div>
      <div class="step" id="s4"><span>📊</span> Фундаментал и мультипликаторы</div>
      <div class="step" id="s5"><span>📈</span> Техника PDH/PDL и уровни</div>
      <div class="step" id="s6"><span>⏰</span> Катализаторы и события до 2028</div>
      <div class="step" id="s7"><span>🛡️</span> Риск-менеджмент по Герчику</div>
      <div class="step" id="s8"><span>🎯</span> Финальный вердикт STARK</div>
    </div>
  </div>

  <div id="result" class="result"></div>
</div>

<script>
function saveCRKey() {
  const key = document.getElementById('crKeyInput').value.trim();
  if (!key) { setCRStatus('❌ Введи ключ', 'var(--red)'); return; }
  localStorage.setItem('crazyrouter_key', key);
  setCRStatus('✅ СОХРАНЁН', 'var(--green)');
}
function saveTVKey() {
  const key = document.getElementById('tvKeyInput').value.trim();
  if (!key) { setTVStatus('❌ Введи ключ', 'var(--red)'); return; }
  localStorage.setItem('tavily_key', key);
  setTVStatus('✅ СОХРАНЁН', 'var(--green)');
}
function setCRStatus(msg, color) { const el = document.getElementById('crKeyStatus'); el.textContent = msg; el.style.color = color; }
function setTVStatus(msg, color) { const el = document.getElementById('tvKeyStatus'); el.textContent = msg; el.style.color = color; }
function setTicker(t) { document.getElementById('tickerInput').value = t; }
function showError(msg) { const el = document.getElementById('errorBox'); el.textContent = '⚠ ' + msg; el.classList.add('show'); }
function hideError() { document.getElementById('errorBox').classList.remove('show'); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('tickerInput').addEventListener('keydown', e => { if (e.key === 'Enter') analyze(); });
  const cr = localStorage.getItem('crazyrouter_key');
  const tv = localStorage.getItem('tavily_key');
  if (cr) { setCRStatus('✅ СОХРАНЁН', 'var(--green)'); document.getElementById('crKeyInput').value = cr; }
  if (tv) { setTVStatus('✅ СОХРАНЁН', 'var(--green)'); document.getElementById('tvKeyInput').value = tv; }
});

// ─── Универсальный экстрактор строки из поля объекта ──────────────────────
function extractStr(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object') {
    // Попробуем распространённые поля
    return val.name || val.label || val.title || val.value || val.text || val.description || JSON.stringify(val);
  }
  return String(val);
}

async function analyze() {
  const ticker = document.getElementById('tickerInput').value.trim().toUpperCase();
  const context = document.getElementById('contextInput').value.trim();
  const crKey = localStorage.getItem('crazyrouter_key');

  hideError();
  if (!ticker) { showError('Введи тикер'); return; }
  if (!crKey) { showError('Сохрани Crazyrouter API ключ'); return; }

  document.getElementById('analyzeBtn').disabled = true;
  document.getElementById('result').classList.remove('show');
  document.getElementById('result').innerHTML = '';
  document.getElementById('loading').classList.add('show');

  const steps = ['s1','s2','s3','s4','s5','s6','s7','s8'];
  steps.forEach(s => document.getElementById(s).className = 'step');

  document.getElementById('s1').className = 'step active';
  document.getElementById('s2').className = 'step active';

  const dataPrompt = `Используй web_search tool чтобы найти актуальные данные по акции ${ticker} прямо сейчас (май 2026).
Поищи: "${ticker} stock price today 2026", "${ticker} insider buying SEC Form 4 2026", "${ticker} earnings date 2026".
Нужно:
1. Текущая цена и изменение за год
2. Market Cap, P/E, дивиденд
3. 52W High и 52W Low
4. Последние новости (1-2 предложения)
5. Инсайдерские покупки CEO/CFO из SEC Form 4 за последние 6 месяцев
6. Ближайшие события (отчёты, дивиденды)
Отвечай кратко, только факты.`;

  let rawData = '';
  try {
    const r1 = await fetch('https://star-agent-murex.vercel.app/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'analyze', prompt: dataPrompt })
    });
    const d1 = await r1.json();
    rawData = d1.text || '';
    console.log('RAW DATA FROM STEP1:', rawData.slice(0, 300));
  } catch(e) { console.error('Step1 error:', e); }

  document.getElementById('s1').className = 'step done';
  document.getElementById('s2').className = 'step done';

  for (let i = 2; i < steps.length - 1; i++) {
    document.getElementById(steps[i]).className = 'step active';
    await sleep(400);
    document.getElementById(steps[i]).className = 'step done';
  }
  document.getElementById(steps[steps.length-1]).className = 'step active';

  const prompt = `Ты — STARK AI. Сделай полный анализ акции ${ticker}.

АКТУАЛЬНЫЕ ДАННЫЕ (найдены через веб-поиск только что):
${rawData || 'Используй свои знания'}

${context ? 'Гипотеза инвестора: ' + context : ''}

ВАЖНО: Верни СТРОГО валидный JSON без markdown, без текста вокруг. Все строковые поля — только строки. Массивы correlationChain — ТОЛЬКО строки (не объекты). Массивы insiders и events — объекты с конкретными полями ниже.

Формат insiders: [{"name":"Имя Фамилия","role":"CEO/CFO/Director","type":"buy","amount":"$500K","shares":"10000","date":"15 янв 2026"}]
Формат events: [{"date":"25 июн 2026","text":"Описание события","urgent":false}]
Формат chartEvents: [{"date":"2024","price":85,"type":"peak","label":"ATH","driver":"Причина роста"}]
Формат correlationChain: ["элемент1","элемент2","элемент3"]

JSON шаблон:
{"ticker":"${ticker}","name":"","sector":"","exchange":"","price":"$0","priceNum":0,"change":"0%","marketCap":"","pe":"","dividend":"","week52Low":"","week52High":"","week52LowNum":0,"week52HighNum":0,"atHigh":"","verdict":"НАБЛЮДАТЬ","verdictEn":"watch","confidence":"СРЕДНЯЯ","rr":"2:1","support":"","entry":"","resistance":"","target1":"","target1Pct":"","target1Period":"","target2":"","target2Pct":"","target2Period":"","target3":"","target3Pct":"","target3Period":"","webDataSummary":"","correlation":"","correlationChain":[],"insiders":[],"events":[],"bullCase":"","bearCase":"","verdict_text":"","stopLoss":"","macro":"","chartEvents":[]}`;

  try {
    const res = await fetch('https://star-agent-murex.vercel.app/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'analyze', prompt })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error || 'API Error');

    const text = data.text || '';
    console.log('RAW JSON TEXT:', text.slice(0, 600));

    let stock;
    try {
      const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      try { stock = JSON.parse(cleaned); } catch(e) {}
      if (!stock) {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
          try { stock = JSON.parse(cleaned.slice(start, end + 1)); } catch(e) {}
        }
      }
      if (!stock) throw new Error('JSON не найден');
    } catch(e) {
      throw new Error('Ошибка парсинга — попробуй ещё раз');
    }

    console.log('PARSED STOCK:', JSON.stringify(stock).slice(0, 400));

    steps.forEach(s => document.getElementById(s).className = 'step done');
    await sleep(400);
    document.getElementById('loading').classList.remove('show');

    const safe = (v, def='—') => (v !== undefined && v !== null && v !== '') ? v : def;

    // ─── Нормализация correlationChain — всегда массив строк ───────────
    let corrChain = [];
    if (Array.isArray(stock.correlationChain)) {
      corrChain = stock.correlationChain.map(c => extractStr(c)).filter(Boolean);
    }

    // ─── Нормализация insiders — унификация полей ───────────────────────
    let insiders = [];
    if (Array.isArray(stock.insiders)) {
      insiders = stock.insiders.map(i => ({
        name: extractStr(i.name || i.person || i.insider || ''),
        role: extractStr(i.role || i.title || i.position || ''),
        type: (i.type || i.signal || i.action || 'buy').toString().toLowerCase().includes('buy') ? 'buy' : 'sell',
        amount: extractStr(i.amount || i.value || i.sum || ''),
        shares: extractStr(i.shares || i.quantity || ''),
        date: extractStr(i.date || i.transactionDate || '')
      }));
    }

    // ─── Нормализация events ────────────────────────────────────────────
    let events = [];
    if (Array.isArray(stock.events)) {
      events = stock.events.map(e => ({
        date: extractStr(e.date || e.when || ''),
        text: extractStr(e.text || e.description || e.event || e.title || ''),
        urgent: !!(e.urgent || e.important)
      }));
    }

    // ─── Нормализация chartEvents ───────────────────────────────────────
    let chartEvents = [];
    if (Array.isArray(stock.chartEvents)) {
      chartEvents = stock.chartEvents.map(e => ({
        date: extractStr(e.date || ''),
        price: parseFloat(e.price || e.value || 0),
        type: extractStr(e.type || 'catalyst'),
        label: extractStr(e.label || e.title || ''),
        driver: extractStr(e.driver || e.description || e.reason || '')
      })).filter(e => e.price > 0);
    }

    const norm = {
      ticker: safe(stock.ticker, ticker),
      name: safe(stock.name, stock.company || stock.fullName || ticker),
      sector: safe(stock.sector, stock.industry || 'N/A'),
      exchange: safe(stock.exchange, 'NYSE'),
      price: (() => {
        const p = safe(stock.price, stock.currentPrice || stock.lastPrice || '$0').toString();
        return p.includes('$') ? p : '$' + p;
      })(),
      priceNum: parseFloat(String(stock.priceNum || stock.price || '0').replace(/[^0-9.]/g,'')) || 0,
      change: safe(stock.change, stock.priceChange || '0%'),
      marketCap: safe(stock.marketCap, stock.mktCap || 'N/A'),
      pe: safe(stock.pe, stock.peRatio || stock.p_e || 'N/A'),
      dividend: safe(stock.dividend, stock.dividendYield || '0%'),
      week52Low: safe(stock.week52Low, stock['52wLow'] || '0'),
      week52High: safe(stock.week52High, stock['52wHigh'] || '0'),
      week52LowNum: parseFloat(String(stock.week52LowNum || stock['52wLow'] || '0').replace(/[^0-9.]/g,'')) || 0,
      week52HighNum: parseFloat(String(stock.week52HighNum || stock['52wHigh'] || '1').replace(/[^0-9.]/g,'')) || 1,
      atHigh: safe(stock.atHigh, stock.allTimeHigh || stock.ath || 'N/A'),
      verdict: safe(stock.verdict, 'НАБЛЮДАТЬ'),
      verdictEn: safe(stock.verdictEn, 'watch'),
      confidence: safe(stock.confidence, 'СРЕДНЯЯ'),
      rr: safe(stock.rr, stock.riskReward || '2:1'),
      support: safe(stock.support, '0'),
      entry: safe(stock.entry, stock.entryPoint || '0'),
      resistance: safe(stock.resistance, '0'),
      target1: safe(stock.target1, '0'),
      target1Pct: safe(stock.target1Pct, '+0%'),
      target1Period: safe(stock.target1Period, '3-6 мес'),
      target2: safe(stock.target2, '0'),
      target2Pct: safe(stock.target2Pct, '+0%'),
      target2Period: safe(stock.target2Period, '6-12 мес'),
      target3: safe(stock.target3, '0'),
      target3Pct: safe(stock.target3Pct, '+0%'),
      target3Period: safe(stock.target3Period, '12-24 мес'),
      webDataSummary: safe(stock.webDataSummary, stock.summary || ''),
      correlation: safe(stock.correlation, stock.hiddenCorrelation || 'Нет данных'),
      correlationChain: corrChain,
      insiders: insiders,
      events: events,
      bullCase: safe(stock.bullCase, stock.bull || 'Нет данных'),
      bearCase: safe(stock.bearCase, stock.bear || 'Нет данных'),
      verdict_text: safe(stock.verdict_text, stock.verdictText || stock.analysis || 'Нет данных'),
      stopLoss: safe(stock.stopLoss, stock.stop || '0'),
      macro: safe(stock.macro, stock.macroContext || ''),
      chartEvents: chartEvents
    };

    renderResult(norm);

  } catch(e) {
    document.getElementById('loading').classList.remove('show');
    showError(e.message);
    steps.forEach(s => document.getElementById(s).className = 'step');
  } finally {
    document.getElementById('analyzeBtn').disabled = false;
  }
}

function renderResult(s) {
  const verdictClass = {'buy':'verdict-buy','watch':'verdict-watch','wait':'verdict-wait','sell':'verdict-sell'}[s.verdictEn] || 'verdict-watch';
  const lo = s.week52LowNum || 0;
  const hi = s.week52HighNum || 1;
  const cur = s.priceNum || (lo+hi)/2;
  const pct = Math.min(100, Math.max(0, ((cur-lo)/(hi-lo))*100));

  const insidersHtml = s.insiders.length ? s.insiders.map(i => `
    <div class="insider-item">
      <div><div class="insider-name">${i.name || '—'}</div><div class="insider-role">${i.role || '—'}</div></div>
      <div class="insider-amount ${i.type === 'buy' ? 'insider-buy' : 'insider-sell'}">${i.type === 'buy' ? 'ПОКУПКА' : 'ПРОДАЖА'} ${i.amount || ''} ${i.shares ? '(' + i.shares + ' акций)' : ''}</div>
      <div class="insider-date">${i.date || '—'}</div>
    </div>`).join('')
    : '<div style="font-size:11px;color:var(--dim)">Нет данных по инсайдерам за последние 6 месяцев</div>';

  const eventsHtml = s.events.length ? s.events.map(e => `
    <div class="event-item">
      <div class="event-date">${e.date || '—'}</div>
      <div class="event-text">${e.text || '—'}${e.urgent ? '<span class="event-tag tag-urgent">СРОЧНО</span>' : '<span class="event-tag tag-catalyst">КАТАЛИЗАТОР</span>'}</div>
    </div>`).join('')
    : '<div style="font-size:11px;color:var(--dim)">Нет данных о событиях</div>';

  const chainHtml = s.correlationChain.map((c, i, arr) =>
    `<span class="corr-node">${c}</span>${i < arr.length-1 ? '<span class="corr-arrow">→</span>' : ''}`
  ).join('');

  document.getElementById('result').innerHTML = `
    <div class="stock-hdr">
      <div>
        <div class="stock-name">${s.ticker}</div>
        <div class="stock-full">${s.name}</div>
        <div class="stock-sector">${s.sector} · ${s.exchange}</div>
      </div>
      <div class="stock-price-block">
        <div class="stock-price">${s.price}</div>
        <div class="stock-change ${s.change && s.change.includes('+') ? 'pos' : 'neg'}">${s.change}</div>
        <div><span class="verdict-badge ${verdictClass}">${s.verdict}</span></div>
        <div style="font-size:10px;color:var(--dim);margin-top:6px">R:R ${s.rr} · ${s.confidence} уверенность</div>
      </div>
    </div>
    <div class="metrics">
      <div class="metric"><div class="metric-label">МКТ КАП</div><div class="metric-val">${s.marketCap}</div></div>
      <div class="metric"><div class="metric-label">P/E</div><div class="metric-val">${s.pe}</div></div>
      <div class="metric"><div class="metric-label">ДИВИДЕНД</div><div class="metric-val">${s.dividend}</div></div>
      <div class="metric"><div class="metric-label">52W LOW</div><div class="metric-val">${s.week52Low}</div></div>
      <div class="metric"><div class="metric-label">52W HIGH</div><div class="metric-val">${s.week52High}</div></div>
      <div class="metric"><div class="metric-label">ATH</div><div class="metric-val">${s.atHigh}</div></div>
      <div class="metric"><div class="metric-label">СТОП</div><div class="metric-val" style="color:var(--red)">${s.stopLoss}</div></div>
      <div class="metric"><div class="metric-label">БИРЖА</div><div class="metric-val">${s.exchange}</div></div>
    </div>
    <div class="price-bar">
      <div class="bar-title">52-НЕДЕЛЬНЫЙ ДИАПАЗОН</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%"></div>
        <div class="bar-marker" style="left:${pct}%"></div>
      </div>
      <div class="bar-labels"><span>${s.week52Low}</span><span style="color:var(--gold)">СЕЙЧАС ${s.price}</span><span>${s.week52High}</span></div>
      <div class="levels-row">
        <div class="level-item"><div class="level-label">ПОДДЕРЖКА</div><div class="level-val lvl-sup">${s.support}</div></div>
        <div class="level-item"><div class="level-label">ТОЧКА ВХОДА</div><div class="level-val lvl-entry">${s.entry}</div></div>
        <div class="level-item"><div class="level-label">СОПРОТИВЛЕНИЕ</div><div class="level-val lvl-res">${s.resistance}</div></div>
      </div>
    </div>
    <div class="targets">
      <div class="target"><div class="target-label">ЦЕЛЬ 1</div><div class="target-price">${s.target1}</div><div class="target-pct">${s.target1Pct}</div><div class="target-period">${s.target1Period}</div></div>
      <div class="target"><div class="target-label">ЦЕЛЬ 2</div><div class="target-price">${s.target2}</div><div class="target-pct">${s.target2Pct}</div><div class="target-period">${s.target2Period}</div></div>
      <div class="target"><div class="target-label">ЦЕЛЬ 3</div><div class="target-price">${s.target3}</div><div class="target-pct">${s.target3Pct}</div><div class="target-period">${s.target3Period}</div></div>
    </div>
    <div class="corr-section">
      <div class="corr-title">🔗 СКРЫТАЯ КОРРЕЛЯЦИЯ — МЕТОД АЛЕКСЕЯ</div>
      <div class="corr-text">${s.correlation}</div>
      <div class="corr-chain">${chainHtml || '<span style="color:var(--dim);font-size:11px">Нет данных</span>'}</div>
    </div>
    <div class="insiders-section">
      <div class="insiders-title">👔 ИНСАЙДЕРЫ И УМНЫЕ ДЕНЬГИ — SEC FORM 4</div>
      ${insidersHtml}
    </div>
    <div class="events-section">
      <div class="events-title">⏰ СОБЫТИЯ И КАТАЛИЗАТОРЫ ДО 2028</div>
      ${eventsHtml}
    </div>
    <div class="cases">
      <div class="case-item"><div class="case-title bull">▲ БЫЧИЙ КЕЙС</div><div class="case-text">${s.bullCase}</div></div>
      <div class="case-item"><div class="case-title bear">▼ МЕДВЕЖИЙ КЕЙС</div><div class="case-text">${s.bearCase}</div></div>
    </div>
    <div class="verdict-section">
      <div class="verdict-title">🎯 ВЕРДИКТ STARK — 8 УРОВНЕЙ</div>
      <div class="verdict-text">${s.verdict_text}</div>
      <div style="margin-top:12px;font-size:11px;color:var(--dim)">${s.macro}</div>
      <div class="verdict-phrase">ВОТ ТАК ЗАКАЛЯЕТСЯ ХАРАКТЕР.</div>
    </div>
    <div class="chart-section">
      <div class="chart-title">📈 ИСТОРИЯ ЦЕНЫ — КЛЮЧЕВЫЕ СОБЫТИЯ И ДРАЙВЕРЫ</div>
      <div class="chart-wrap">
        <canvas id="priceChart"></canvas>
        <div class="chart-tooltip" id="chartTooltip">
          <div class="tt-date" id="ttDate"></div>
          <div class="tt-price" id="ttPrice"></div>
          <div class="tt-driver" id="ttDriver"></div>
        </div>
      </div>
      <div class="chart-events-list" id="chartEventsList"></div>
    </div>`;

  document.getElementById('result').classList.add('show');
  document.getElementById('result').scrollIntoView({ behavior: 'smooth' });
  setTimeout(() => drawChart(s.chartEvents || []), 100);
}

function drawChart(events) {
  const canvas = document.getElementById('priceChart');
  if (!canvas || !events.length) return;
  const ctx = canvas.getContext('2d');
  const wrap = canvas.parentElement;
  canvas.width = wrap.offsetWidth;
  canvas.height = wrap.offsetHeight;
  const W = canvas.width, H = canvas.height;
  const pad = { top: 20, right: 20, bottom: 40, left: 50 };

  const prices = events.map(e => e.price);
  const minP = Math.min(...prices) * 0.9;
  const maxP = Math.max(...prices) * 1.1;
  const typeColor = { peak: '#C9A84C', crash: '#E05252', catalyst: '#4CAF7D', current: '#4A9EFF' };

  const xOf = (i) => pad.left + (i / (events.length - 1)) * (W - pad.left - pad.right);
  const yOf = (p) => pad.top + (1 - (p - minP) / (maxP - minP)) * (H - pad.top - pad.bottom);

  ctx.strokeStyle = '#1A1A1A'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (i / 4) * (H - pad.top - pad.bottom);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    const val = maxP - (i / 4) * (maxP - minP);
    ctx.fillStyle = '#444'; ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText('$' + val.toFixed(0), 4, y + 4);
  }

  const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
  grad.addColorStop(0, 'rgba(201,168,76,0.2)');
  grad.addColorStop(1, 'rgba(201,168,76,0)');
  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(events[0].price));
  events.forEach((e, i) => ctx.lineTo(xOf(i), yOf(e.price)));
  ctx.lineTo(xOf(events.length - 1), H - pad.bottom);
  ctx.lineTo(xOf(0), H - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath(); ctx.strokeStyle = '#C9A84C'; ctx.lineWidth = 2;
  events.forEach((e, i) => i === 0 ? ctx.moveTo(xOf(i), yOf(e.price)) : ctx.lineTo(xOf(i), yOf(e.price)));
  ctx.stroke();

  events.forEach((e, i) => {
    const x = xOf(i), y = yOf(e.price);
    const color = typeColor[e.type] || '#888';
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = '#080808'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = color; ctx.font = 'bold 10px JetBrains Mono, monospace';
    ctx.fillText(e.label, Math.max(pad.left, Math.min(W - pad.right - 40, x - 20)), y - 12);
    ctx.fillStyle = '#444'; ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillText(e.date, Math.max(pad.left, x - 18), H - pad.bottom + 16);
  });

  const tooltip = document.getElementById('chartTooltip');
  canvas.addEventListener('mousemove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (ev.clientX - rect.left) * (W / rect.width);
    let closest = null, minDist = 999;
    events.forEach((e, i) => { const d = Math.abs(xOf(i) - mx); if (d < minDist) { minDist = d; closest = { e, i }; } });
    if (closest && minDist < 40) {
      document.getElementById('ttDate').textContent = closest.e.date;
      document.getElementById('ttPrice').textContent = '$' + closest.e.price;
      document.getElementById('ttDriver').textContent = closest.e.driver;
      tooltip.style.left = Math.min(ev.clientX - rect.left + 12, rect.width - 250) + 'px';
      tooltip.style.top = Math.max(0, ev.clientY - rect.top - 60) + 'px';
      tooltip.style.display = 'block';
    } else { tooltip.style.display = 'none'; }
  });
  canvas.addEventListener('mouseleave', () => tooltip.style.display = 'none');

  const typeColor2 = { peak: 'ev-peak', crash: 'ev-crash', catalyst: 'ev-catalyst', current: 'ev-current' };
  const list = document.getElementById('chartEventsList');
  if (list) {
    list.innerHTML = events.map(e => `
      <div class="chart-event-item">
        <div class="ev-dot ${typeColor2[e.type] || 'ev-catalyst'}"></div>
        <div class="ev-date">${e.date}</div>
        <div class="ev-label">${e.label}</div>
        <div class="ev-driver">${e.driver}</div>
      </div>`).join('');
  }
}
</script>
</body>
</html>
