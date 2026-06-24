// STARK Agent — синхронизация состояния (журнал/портфель/сайзинг/привычки/протокол).
// Тот же механизм и тот же ключ, что у агента дисциплины: одно состояние JSON в Upstash Redis.
// Подключи ТУ ЖЕ базу Upstash, что у дисциплины (Storage → Upstash for Redis),
// либо скопируй её KV_REST_API_URL и KV_REST_API_TOKEN в ENV этого проекта и сделай Redeploy.
// Тогда существующий журнал/история продолжатся здесь — это и есть «один журнал».

export const config = { maxDuration: 10 };

const STATE_KEY = 'stark:state:v1'; // тот же ключ, что у дисциплины — данные общие

function getEnv() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return { url, token };
}

// Upstash REST: GET значение по ключу
async function redisGet(url, token, key) {
  const r = await fetch(url + '/get/' + encodeURIComponent(key), {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!r.ok) throw new Error('redis get ' + r.status);
  const j = await r.json();
  // Upstash возвращает { result: "<строка или null>" }
  if (j.result == null) return null;
  try { return JSON.parse(j.result); } catch { return null; }
}

// Upstash REST: SET значение (через POST body, чтобы не упереться в лимит URL)
async function redisSet(url, token, key, valueObj) {
  const body = JSON.stringify(valueObj);
  const r = await fetch(url + '/set/' + encodeURIComponent(key), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'text/plain' },
    body,
  });
  if (!r.ok) throw new Error('redis set ' + r.status);
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-stark-pin');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, token } = getEnv();
  if (!url || !token) {
    // Хранилище не подключено — фронт сам уйдёт в локальный режим.
    return res.status(503).json({ error: 'no_storage', message: 'Upstash не подключён (нет KV_REST_API_URL/KV_REST_API_TOKEN). Приложение работает локально.' });
  }

  // Опциональная PIN-защита (как у дисциплины): ENV STARK_PIN + заголовок x-stark-pin.
  const pin = process.env.STARK_PIN || '';
  if (pin) {
    const sent = req.headers['x-stark-pin'] || '';
    if (sent !== pin) return res.status(401).json({ error: 'pin', message: 'Неверный PIN' });
  }

  try {
    if (req.method === 'GET') {
      const state = await redisGet(url, token, STATE_KEY);
      return res.status(200).json(state || {});
    }
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
      if (!body || typeof body !== 'object') return res.status(400).json({ error: 'bad_body' });
      await redisSet(url, token, STATE_KEY, body);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    return res.status(500).json({ error: 'storage_failed', message: String(e && e.message || e) });
  }
}
