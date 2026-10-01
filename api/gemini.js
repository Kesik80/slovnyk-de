// Wörter — автозаполнение карточек через Gemini (бесплатный тариф).
// ENV: GEMINI_API_KEY (или GOOGLE_API_KEY, или GEMINI_API_KEYS через запятую) — обязательно
//      MODEL_TEXT   — первая модель цепочки, по умолчанию gemini-3.5-flash-lite
//      OZV_PASSWORD — код доступа (обязательно: без него функция выключена)
// Запрос:  POST {a:'fill', items:[{word:'Tisch', tr:'стол'(необязательно)}, ...]}   до 15 слов за раз
// Ответ:   {items:[{word,tr,pos,conj,decl,ex,def,ipa}], model, tried}

// запрос с таймаутом: без него зависший провайдер съедает все 60 секунд функции
async function fetchT(url, opt, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 25000);
  try { return await fetch(url, Object.assign({}, opt, { signal: ctl.signal })); }
  finally { clearTimeout(t); }
}

function keys() {
  const out = [];
  const add = v => { const k = String(v || '').trim(); if (k && !out.includes(k)) out.push(k); };
  add(process.env.GEMINI_API_KEY); add(process.env.GOOGLE_API_KEY);
  String(process.env.GEMINI_API_KEYS || '').split(',').forEach(add);
  return out;
}

const SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      word: { type: 'STRING' }, tr: { type: 'STRING' }, pos: { type: 'STRING' },
      conj: { type: 'STRING' }, decl: { type: 'STRING' }, ex: { type: 'STRING' },
      def: { type: 'STRING' }, ipa: { type: 'STRING' },
      pres: { type: 'ARRAY', items: { type: 'STRING' } },
      prat: { type: 'ARRAY', items: { type: 'STRING' } },
      perf: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['word', 'tr', 'pos', 'conj', 'decl', 'ex', 'def', 'ipa', 'pres', 'prat', 'perf'],
  },
};

async function ask(key, model, prompt, simple) {
  const cfg = { temperature: 0.2, responseMimeType: 'application/json' };
  if (/(2\.5|3|3\.5)-flash/.test(model)) cfg.thinkingConfig = { thinkingBudget: 0 };
  if (!simple) cfg.responseSchema = SCHEMA;
  const r = await fetchT('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: cfg }),
  }, 30000);
  const txt = await r.text();
  if (!r.ok) {
    let msg = 'Gemini ' + r.status;
    try { msg = JSON.parse(txt).error.message || msg; } catch (e) {}
    const e = new Error(msg); e.status = r.status; throw e;
  }
  const j = JSON.parse(txt);
  const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
  let body = parts.map(p => p.text || '').join('').trim();
  if (body[0] !== '[') { const a2 = body.indexOf('['), b2 = body.lastIndexOf(']'); if (a2 >= 0 && b2 > a2) body = body.slice(a2, b2 + 1); }
  return JSON.parse(body || '[]');
}

// какие модели вообще доступны этому ключу
async function listModels(key) {
  const r = await fetchT('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } }, 10000);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => String(m.name || '').replace(/^models\//, ''))
    .filter(n => /flash|pro/.test(n) && !/vision|image|audio|tts|embedding|live|thinking/.test(n))
    .sort((a, b) => (/flash/.test(b) ? 1 : 0) - (/flash/.test(a) ? 1 : 0));
}

function buildPrompt(items) {
  return 'You are a German–Russian dictionary for a learner (level A2–B1). The user writes in Russian.\n' +
    'For EACH item below return one object, same number of items and same order. Fields:\n' +
    '- "word": ALWAYS German. If the item\'s "word" is written in Russian (Cyrillic), it is the MEANING: put the best matching German dictionary word here and put the given Russian word first in "tr" (then at most two close synonyms). Otherwise: dictionary form, corrected if there is a typo. Nouns in singular WITH article ("der Tisch"); verbs in the infinitive (a separable verb as one word: "aufstehen"); adjectives in the base form.\n' +
    '- "tr": Russian translation: the one to three most common meanings separated by commas; verbs in the Russian infinitive; no explanations, no brackets. If the item has a non-empty "tr", keep it exactly as given.\n' +
    '- "pos": "noun", "verb", "adj" or "other".\n' +
    '- "conj": VERBS ONLY: the three principal forms separated by " · ": 3rd person singular present, 3rd person singular Präteritum, Perfekt with the auxiliary. Example: "hat · hatte · hat gehabt", "geht · ging · ist gegangen". Empty string for other words.\n' +
    '- "pres", "prat", "perf": VERBS ONLY: full conjugation tables as arrays of EXACTLY 6 strings, in the order ich, du, er/sie/es, wir, ihr, sie/Sie. Each string is ONLY the verb form WITHOUT the pronoun. "pres" = Präsens ("habe", "hast", "hat", "haben", "habt", "haben"); separable verbs put the prefix last ("stehe auf"); reflexive verbs include the pronoun ("freue mich", "freust dich", "freut sich", "freuen uns", "freut euch", "freuen sich"). "prat" = Präteritum ("hatte", "hattest", "hatte", "hatten", "hattet", "hatten"). "perf" = Perfekt with the correct auxiliary haben/sein and Partizip II ("habe gehabt", "hast gehabt", "hat gehabt", "haben gehabt", "habt gehabt", "haben gehabt"; "bin gewesen", "bist gewesen", "ist gewesen", "sind gewesen", "seid gewesen", "sind gewesen"). For modal and irregular verbs use the real forms. For all non-verbs return three empty arrays [].\n' +
    '- "decl": NOUNS: nominative singular, genitive singular, nominative plural separated by " · ", e.g. "der Tisch · des Tisches · die Tische". ADJECTIVES: positive · comparative · superlative, e.g. "schnell · schneller · am schnellsten". Empty string for others.\n' +
    '- "ex": exactly two short natural example sentences in German (A2–B1), each followed by " — " and its Russian translation, the two lines separated by a newline character.\n' +
    '- "def": one short simple definition in German, at most 12 words.\n' +
    '- "ipa": IPA transcription of "word" in square brackets, e.g. "[tɪʃ]".\n' +
    'If an item is not a German word, still fill every field as well as possible. Return only the JSON array. Items: ' + JSON.stringify(items);
}

// таблица глагола: ровно 6 непустых форм или пустой массив
const forms = a => {
  const r = (Array.isArray(a) ? a : []).map(v => clamp(v, 40));
  return r.length === 6 && r.every(Boolean) ? r : [];
};
const clamp = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Только POST', code: 'method' });
  // код доступа обязателен: без него функция — открытый прокси к ключам
  const pass = String(process.env.OZV_PASSWORD || '').trim();
  if (!pass) return res.status(503).json({ error: 'В Vercel не задан OZV_PASSWORD — функция выключена', code: 'no_pass' });
  if (String(req.headers['x-ozv-pass'] || '').trim() !== pass) return res.status(401).json({ error: 'Нужен код доступа', code: 'need_pass' });
  const K = keys();
  if (!K.length) return res.status(500).json({ error: 'В Vercel не задан GEMINI_API_KEY', code: 'no_keys' });

  let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};
  if (b.a !== 'fill') return res.status(400).json({ error: 'Неизвестное действие', code: 'action' });
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 15)
    .map(x => ({ word: clamp(x && x.word, 60), tr: clamp(x && x.tr, 120) }))
    .filter(x => x.word);
  if (!items.length) return res.status(400).json({ error: 'Нет слов', code: 'empty' });
  const prompt = buildPrompt(items);

  const first = [process.env.MODEL_TEXT || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-flash-latest']
    .filter((m, i, a2) => m && a2.indexOf(m) === i);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const t0 = Date.now();
  const tried = [];
  let last = null, dayLimit = false;
  for (const key of K) {
    const models = first.slice();
    let discovered = false, keyDead = false;
    for (let mi = 0; mi < models.length && !keyDead; mi++) {
      const model = models[mi];
      let simple = false;
      for (let att = 0; att < 3; att++) {
        if (Date.now() - t0 > 48000) { last = last || new Error('Не хватило времени'); tried.push('время вышло'); keyDead = true; break; }
        try {
          const out = await ask(key, model, prompt, simple);
          if (!Array.isArray(out) || out.length !== items.length) {
            last = new Error('Gemini вернул ' + (Array.isArray(out) ? out.length : 0) + ' карточек вместо ' + items.length);
            tried.push(model + ' → формат');
            break;
          }
          const pos = ['noun', 'verb', 'adj', 'other'];
          const result = out.map((x, i) => {
            x = x || {};
            const p = String(x.pos || '').toLowerCase();
            return {
              word: clamp(x.word, 60) || items[i].word,
              tr: items[i].tr || clamp(x.tr, 120),
              pos: pos.includes(p) ? p : 'other',
              conj: clamp(x.conj, 120), decl: clamp(x.decl, 120),
              ex: clamp(x.ex, 400), def: clamp(x.def, 200), ipa: clamp(x.ipa, 60),
              pres: forms(x.pres), prat: forms(x.prat), perf: forms(x.perf),
            };
          });
          return res.status(200).json({ items: result, model, tried });
        } catch (e) {
          last = e;
          tried.push(model + ' → ' + (e.status || '?') + ' ' + String(e.message).slice(0, 70));
          if (e.status === 400 && !simple) { simple = true; continue; }        // не понимает схему/бюджет мыслей
          if (e.status === 429 && /per ?day|daily|quota|exhaust/i.test(String(e.message))) { dayLimit = true; keyDead = true; break; }  // дневной лимит
          if (e.status === 404) break;                                          // такой модели нет
          if (e.status === 429 || e.status >= 500) { await sleep(700 * (att + 1)); continue; }
          if (e.status === 401 || e.status === 403) keyDead = true;             // ключ не работает
          break;
        }
      }
      // основные модели не сработали — спрашиваем у Gemini, что вообще доступно ключу
      if (!keyDead && !discovered && mi === models.length - 1) {
        discovered = true;
        try { (await listModels(key)).forEach(n => { if (!models.includes(n) && models.length < first.length + 4) models.push(n); }); }
        catch (e) {}
      }
    }
  }
  const raw = last ? last.message : 'Нет ответа';
  const msg = dayLimit || /quota|rate limit|resource_exhausted/i.test(raw) ? 'Дневной лимит Gemini исчерпан — продолжите завтра'
    : /high demand|overloaded|unavailable/i.test(raw) ? 'Gemini сейчас перегружен — попробуйте ещё раз через минуту'
    : /api key|permission|unauthenticated/i.test(raw) ? 'Ключ Gemini не работает: ' + raw : raw;
  return res.status(502).json({ error: msg, code: dayLimit ? 'day_limit' : 'gemini', raw, tried });
};

module.exports.config = { maxDuration: 60 };
