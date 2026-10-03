// Wörter — глаголы с verbformen.ru / .de (без Gemini). Основа разбора — из рабочего проекта verb-de, блоки карточки проверены на сохранённых страницах.
// ENV: OZV_PASSWORD — код доступа (обязательно, как у gemini)
// Запрос:  POST {words:['rauchen','gehen']}   до 10 слов
// Ответ:   {items:[ null | {word,tr,pos:'verb',irr,conj,pres,prat,perf,ipa,decl:'',ex:'',def:''} ]}
//          null = страницы нет или разбор не удался (приложение спросит Gemini)

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

async function getPage(word, host) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  const url = host === 'ru'
    ? 'https://www.verbformen.ru/sprjazhenie/' + encodeURIComponent(word) + '.htm'
    : 'https://www.verbformen.de/konjugation/?w=' + encodeURIComponent(word);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      headers: {
        'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ru-RU,ru;q=0.9,de;q=0.8', 'Referer': 'https://www.verbformen.' + host + '/',
      },
    });
    if (!r.ok) return null;
    return await r.text();
  } catch (e) { return null; } finally { clearTimeout(t); }
}

const dec = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&shy;/g, '').replace(/&middot;/g, '·')
  .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c)).replace(/­/g, '');
const strip = s => dec(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// ячейка формы: слоги разбиты тегами, поэтому теги убираем БЕЗ пробелов
function formatCell(h) {
  return dec(h.replace(/<[^>]+>/g, ''))
    .replace(/\/[^\s,]+/g, '')                                  // варианты после «/»
    .replace(/[⁰-⁹¹²³]+/g, '')         // сноски
    .replace(/\(\s*([a-zäöüß]*)\s*\)/g, '$1')
    .replace(/\s+/g, ' ').trim();
}

function findTableAfterMp3(html, key) {
  let result = null, pos = 0;
  for (;;) {
    const m = html.indexOf(key, pos);
    if (m === -1) break;
    const ts = html.indexOf('<table', m);
    if (ts !== -1 && ts - m <= 500) {
      const te = html.indexOf('</table>', ts);
      if (te !== -1) result = html.slice(ts, te + 8);
    }
    pos = m + 1;
  }
  return result;
}

function parseConj(tableHtml) {
  const rows = [];
  let pos = 0;
  for (;;) {
    const rs = tableHtml.indexOf('<tr', pos);
    if (rs === -1) break;
    const re = tableHtml.indexOf('</tr>', rs);
    if (re === -1) break;
    const row = tableHtml.slice(rs, re); pos = re + 5;
    const cells = []; let cp = 0;
    for (;;) {
      const td = row.indexOf('<td', cp);
      if (td === -1) break;
      const tde = row.indexOf('</td>', td);
      if (tde === -1) break;
      cells.push(row.slice(row.indexOf('>', td) + 1, tde));
      cp = tde + 5;
    }
    if (cells.length >= 2 && strip(cells[0])) {
      let form;
      if (cells.length >= 3) {
        const p1 = formatCell(cells[1]), p2 = formatCell(cells[2]);
        form = (p1 + ' ' + p2).trim();                     // «stehe auf», «habe geraucht», «freue mich»
      } else form = formatCell(cells[1]);
      rows.push(form.trim());
    }
  }
  return rows.slice(0, 6);
}

const IPA_CH = /[ɐ-˿ˈˌː]/;
function fixIpa(v) {
  return '[' + v.normalize('NFC').replace(/([mnl])̩/g, (x, c) => 'ə' + c).replace(/x/g, 'χ') + ']';
}

// карточка слова: <span lang="ru">…переводы…</span>, затем <p> с IPA, <p><i>определение</i></p>, <p>» пример <img> перевод</p>
function parseCard(html) {
  const out = { tr: '', ipa: '', def: '', ex: '' };
  const sm = html.match(/<span lang="ru">([\s\S]*?)<\/span>/);
  if (sm) out.tr = strip(sm[1].replace(/<img[^>]*>/g, '')).split(/[,;]/)[0].trim();
  const from = sm ? sm.index : 0;
  const rest = html.slice(from, from + 6000);
  const ip = rest.match(/<p[^>]*>\s*\/([^\/<>]+)\//);                  // первая транскрипция в /…/ — инфинитив
  if (ip && IPA_CH.test(ip[1])) out.ipa = fixIpa(ip[1].trim());
  const dm = rest.match(/<p[^>]*\brNt\b[^>]*>\s*<i>([\s\S]*?)<\/i>\s*<\/p>/);
  if (dm) out.def = strip(dm[1]).split(';')[0].trim();
  const em = rest.match(/<p[^>]*\brNt\b[^>]*>\s*»([\s\S]*?)<\/p>/);
  if (em) {
    const k = em[1].indexOf('<img');
    if (k > 0) {
      const de = strip(em[1].slice(0, k)), ru = strip(em[1].slice(k).replace(/<img[^>]*>/g, ''));
      if (de && ru) out.ex = (de + ' — ' + ru).replace(/\s+([?!.,;:])/g, '$1');
    }
  }
  if (!out.tr) out.tr = transOf(html).split(/[,;]/)[0].trim();
  return out;
}

function transOf(html) {
  const skip = /реклам|сайт|баллов|войти|зарегистр|подписк|аккаунт|пользовател|набер|количеств|претеритум|конъюнктив|императив|перфект|плюсквам|футурум|инфинитив|партицип|упражне|грамматик|правила|переводы|значения|примеры|речевой вывод/i;
  const pm = html.match(/\/[a-zɐ-˿æøəɪː.]+\//);
  if (!pm) return '';
  const chunk = html.slice(Math.max(0, pm.index - 1000), pm.index);
  const blocks = [...chunk.matchAll(/[а-яёА-ЯЁ][а-яёА-ЯЁ\s,\-.;]{8,150}/g)];
  for (const b of blocks.reverse()) {
    const t = b[0].trim().replace(/[,;\s]+$/, '');
    if (!skip.test(t) && t.length > 5) return t;
  }
  return '';
}

// «A1 · неправильный · sein · trennbar» — это <p class="…rInf…"> с «правильный/regelmäßig»
function isIrregular(html) {
  const re = /<p[^>]*class="[^"]*\brInf\b[^"]*"[^>]*>([\s\S]{0,300}?)<\/p>/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = strip(m[1]);
    if (/regelm|правильн/i.test(t)) return /unregelm|неправильн/i.test(t);
  }
  return false;
}

function parse(html, word) {
  const T = {};
  for (const [k, key] of [['pres', 'indikativ/praesens/'], ['prat', 'indikativ/praeteritum/'], ['perf', 'indikativ/perfekt/']]) {
    const t = findTableAfterMp3(html, key);
    const f = t ? parseConj(t) : [];
    if (f.length !== 6 || !f.every(x => x && x.length <= 40)) return null;
    T[k] = f;
  }
  const conj = [T.pres[2], T.prat[2], T.perf[2]].join(' · ');
  const c = parseCard(html);
  return { word, tr: c.tr, pos: 'verb', irr: isIrregular(html), conj, pres: T.pres, prat: T.prat, perf: T.perf, ipa: c.ipa, decl: '', ex: c.ex, def: c.def };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Только POST', code: 'method' });
  const pass = String(process.env.OZV_PASSWORD || '').trim();
  if (!pass) return res.status(503).json({ error: 'В Vercel не задан OZV_PASSWORD — функция выключена', code: 'no_pass' });
  if (String(req.headers['x-ozv-pass'] || '').trim() !== pass) return res.status(401).json({ error: 'Нужен код доступа', code: 'need_pass' });
  let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  const words = (Array.isArray(b && b.words) ? b.words : []).slice(0, 10)
    .map(w => String(w || '').trim().toLowerCase().slice(0, 40));
  const items = await Promise.all(words.map(async w => {
    if (!/^[a-zäöüß]{2,40}$/.test(w)) return null;       // только одно слово, строчными (глагол)
    // сначала .de (разметка проверена на сохранённых страницах), потом .ru: недостающие поля берём оттуда
    let res = null;
    for (const host of ['de', 'ru']) {
      const html = await getPage(w, host);
      if (!html) continue;
      let r = null;
      try { r = parse(html, w); } catch (e) { r = null; }
      if (!r) continue;
      if (!res) res = r;
      else for (const k of ['tr', 'ipa', 'def', 'ex']) if (!res[k] && r[k]) res[k] = r[k];
      if (res.tr && res.ipa && res.def && res.ex) break;
    }
    return res;
  }));
  res.status(200).json({ items });
};
module.exports.config = { maxDuration: 60 };
