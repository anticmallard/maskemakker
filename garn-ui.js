// garn-ui.js — the Garnvælger screens (concept E): the Garn tab with four shortcuts, the catalogue,
// a yarn's own page as the hub, and the tools Find alternativ, Sammenlign, To garner sammen and
// Hvad kan jeg strikke?. Matching lives in garn.js; shared helpers come from app.js through init().
import * as G from './garn.js';

let C = null;   // helpers from app.js
export function init(ctx) { C = ctx; }

const esc = (s) => C.esc(s);

/** The catalogue with your own yarns added. */
async function ensure() {
  const cat = await G.loadCatalog();
  G.useOwnYarns(await C.store.listYarns());
  return cat;
}
/** "64 garner fra Drops og Sandnes Garn + 2 af dine egne" */
const catalogLine = (cat) => `${G.officialCount()} garner fra ${Object.keys(cat.brands).join(' og ')}${G.ownCount() ? ` + ${G.ownCount()} af dine egne` : ''}`;
const num = (n) => Number(n).toLocaleString('da-DK');
const dec = (n) => String(n).replace('.', ',');
const range = (r) => (!r ? '' : r[0] === r[1] ? dec(r[0]) : `${dec(r[0])}–${dec(r[1])}`);

// What you've picked in each tool. Kept while you move around; starts empty on a fresh launch.
const S = {
  kat: { q: '', tyk: null, fiber: null, type: null, brand: null, sort: 'tyk', focus: false },
  alt: { ref: null, amount: '', unit: 'g', combos: false },
  cmp: { a: null, b: null, metres: '500' },
  sammen: { a: null, b: null, metres: '500' },
  strikke: { a: null },
  add: { back: false },   // true when "Tilføj et garn" was opened from Find alternativ
};

/* ---------- icons ---------- */

const svg = (d, w = 2.2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>'),
  alt: svg('<path d="M4 7h10M4 12h16M4 17h7"/><path d="M17 4l3 3-3 3"/>'),
  swap: svg('<path d="M7 7h11l-3-3M17 17H6l3 3"/>'),
  two: svg('<path d="M4 18c4-10 8-10 16-12"/><path d="M4 14c5-7 10-8 16-8"/>'),
  knit: svg('<path d="M7 4l5 7 5-7M7 13l5 7 5-7"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>', 2.4),
  sort: svg('<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>'),
  out: svg('<path d="M7 17L17 7M9 7h8v8"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>', 2.4),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 2.4),
};

/**
 * A small drawing of a strand whose thickness follows the yarn's: fuzz for mohair and brushed yarn,
 * a dotted core for airy yarn.
 */
function strand(thick, structure = 'glat', size = 44) {
  const w = (Math.max(2.2, Math.min(13, (34 - (thick || 30)) * 0.75)) * size) / 44;
  const d = `M${size * 0.2} ${size * 0.78} C ${size * 0.38} ${size * 0.42}, ${size * 0.6} ${size * 0.62}, ${size * 0.8} ${size * 0.22}`;
  const halo = structure === 'mohair' || structure === 'borstet'
    ? `<path d="${d}" style="stroke: currentColor; stroke-opacity: .25" stroke-width="${w + (9 * size) / 44}" stroke-dasharray="1.5 2.5" fill="none" stroke-linecap="round"/>` : '';
  const core = structure === 'luftig'
    ? `<path d="${d}" style="stroke: var(--g-tile)" stroke-width="${w * 0.38}" fill="none" stroke-linecap="round" stroke-dasharray="2 3"/>` : '';
  return `<span class="g-strand" style="width: ${size}px; height: ${size}px"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${halo}<path d="${d}" style="stroke: currentColor" stroke-width="${w}" fill="none" stroke-linecap="round"/>${core}</svg></span>`;
}

/* ---------- small pieces ---------- */

const fibreText = (y) => (y.fibre || []).map((f) => `${f.pct} % ${f.fibre}`).join(', ');
function fibreShort(y) {
  const f = y.fibre || [];
  if (f.length === 1) return `${f[0].pct} % ${f[0].fibre}`;
  const n = f.map((x) => x.fibre);
  return n.length <= 3 ? `${n.slice(0, -1).join(', ')} og ${n[n.length - 1]}` : `${n.slice(0, 2).join(', ')} …`;
}
const brandShort = (b) => (b === 'Sandnes Garn' ? 'Sandnes' : b);
const chip = (r) => `<span class="g-chip ${r}">${r === 'far' ? 'Langt fra' : G.RATING[r] || 'Opskriftens garn'}</span>`;
const tag = (t, cls = '') => `<span class="g-tag ${cls}">${esc(t)}</span>`;

/** Info about a yarn reference, catalogue or your own. */
function info(ref) {
  if (!ref) return null;
  if (ref.id) {
    const y = G.byId(ref.id);
    return y && { y, name: y.name, brand: y.brand, m50: y.m50, thick: y.thick, structure: y.structure, skein: y.skein };
  }
  const c = ref.custom, m50 = (c.m * 50) / c.g;
  return { name: c.name || 'Dit garn', brand: c.brand || '', m50, thick: G.thickFromM50(m50), structure: 'glat', skein: { g: c.g, m: c.m }, custom: c };
}
const sameRef = (a, b) => !!a && !!b && (a.id ? a.id === b.id : !b.id && keyOf(a) === keyOf(b));
const keyOf = (ref) => (ref.id ? ref.id : `x:${(ref.custom.name || '').toLowerCase()}|${(ref.custom.brand || '').toLowerCase()}`);

function slot(ref, { label = 'Vælg garn', act = 'pick-a', side = 'a', remove = false, fixed = false } = {}) {
  const i = info(ref);
  if (!i) return `<button class="g-slot empty" data-act="${act}">${I.plus}<span>${esc(label)}</span></button>`;
  const tagName = fixed ? 'div' : 'button';
  return `<${tagName} class="g-slot ${side}" ${fixed ? '' : `data-act="${act}"`}>${strand(i.thick, i.structure, 36)}
    <span class="g-slot-text"><b>${esc(i.name)}</b><span>${esc([i.brand, `${num(Math.round(i.m50))} m pr. 50 g`].filter(Boolean).join(' · '))}</span></span>
    ${fixed ? '' : `<span class="g-slot-act">${remove ? 'Fjern' : 'Skift'}</span>`}</${tagName}>`;
}

function subHeader(title, sub = '') {
  return `<header class="brandbar project"><div class="proj-bar">
    <button class="icon-btn on-brand" data-act="back" aria-label="Tilbage">${C.icons.back}</button>
    <div class="proj-title g-title">${esc(title)}${sub ? `<span class="g-sub">${esc(sub)}</span>` : ''}</div>
  </div></header>`;
}

function wireCommon(root) {
  root.querySelectorAll('[data-act="back"]').forEach((b) => (b.onclick = () => (history.length > 1 ? history.back() : C.go('#/garn'))));
  root.querySelectorAll('[data-href]').forEach((b) => (b.onclick = () => C.go(b.dataset.href)));
}

/* ---------- your own yarns: from patterns and projects ---------- */

/** Yarns named in your patterns, and how often you have knitted with each. */
async function mine() {
  const [recipes, projects] = await Promise.all([C.store.listRecipes(), C.store.listProjects()]);
  const map = new Map();
  const add = (ref, fn) => {
    if (!ref) return;
    const k = keyOf(ref);
    if (!map.has(k)) map.set(k, { ref, key: k, recipes: [], knitted: [] });
    fn(map.get(k));
  };
  for (const r of recipes) {
    (r.pattern.yarn || []).forEach((y, idx) => add(G.resolvePatternYarn(y), (e) => { if (!e.recipes.some((x) => x.r === r)) e.recipes.push({ r, idx }); }));
  }
  for (const p of projects) {
    if (!C.isFinished(p)) continue;
    for (const ref of usedRefs(p)) add(ref, (e) => e.knitted.push(p));
  }
  return { list: [...map.values()], recipes, projects };
}

/** The yarn(s) a project was knitted with: your own yarn if registered, else the pattern's. */
function usedRefs(p) {
  const own = C.ownYarns(p);
  if (own.length) return own.map((y) => G.resolvePatternYarn({ name: `${y.name || ''} fra ${y.brand || ''}`, text: '' })).filter(Boolean);
  return C.patternYarns(p).map((y) => G.resolvePatternYarn(y)).filter(Boolean);
}

/* ---------- picker: choose a yarn, or type your own ---------- */

/**
 * Full-screen yarn picker. `suggest` = alternatives to show first.
 * Resolves with a yarn reference, or null if closed.
 */
function pickYarn({ title = 'Vælg garn', suggest = [], ownList = [] } = {}) {
  return new Promise((resolve) => {
    const v = document.createElement('div');
    v.className = 'g-picker';
    v.setAttribute('role', 'dialog');
    v.setAttribute('aria-label', title);
    document.body.appendChild(v);
    document.body.classList.add('no-scroll');
    let q = '', mode = 'list';
    const done = (ref) => { v.remove(); document.body.classList.remove('no-scroll'); resolve(ref); };
    const yarnBtn = (ref, right = '') => {
      const i = info(ref);
      return `<button class="g-row" data-key="${esc(keyOf(ref))}">${strand(i.thick, i.structure)}
        <span class="g-row-text"><b>${esc(i.name)}</b><span>${esc(i.y ? `${brandShort(i.brand)} · ${fibreShort(i.y)}` : `${i.brand ? `${i.brand} · ` : ''}${num(Math.round(i.m50))} m pr. 50 g · ikke i garnkataloget`)}</span></span>${right}</button>`;
    };
    const refs = new Map();
    const reg = (ref) => { refs.set(keyOf(ref), ref); return ref; };
    function draw() {
      if (mode === 'form') return drawForm();
      const qq = q.trim().toLowerCase();
      const all = G.catalogYarns().filter((y) => y.structure !== 'effekt' && (!qq || `${y.name} ${y.brand} ${fibreText(y)}`.toLowerCase().includes(qq)))
        .sort((a, b) => a.name.localeCompare(b.name, 'da'));
      const sug = qq ? [] : suggest;
      const own = qq ? ownList.filter((e) => info(e.ref).name.toLowerCase().includes(qq)) : ownList;
      v.innerHTML = `
        <div class="g-picker-bar"><b>${esc(title)}</b><button class="icon-btn" data-act="close" aria-label="Luk">${I.close}</button></div>
        <label class="g-search-field">${I.search}<input id="pk-q" type="search" placeholder="Søg garn" value="${esc(q)}" autocomplete="off"></label>
        <div class="g-picker-body">
          ${sug.length ? `<div class="group-label">Bedste alternativer</div><div class="panel g-list">${sug.map((c) => yarnBtn(reg({ id: c.yarns[0].id }), chip(c.rating))).join('')}</div>` : ''}
          ${own.length ? `<div class="group-label">Fra dine opskrifter</div><div class="panel g-list">${own.map((e) => yarnBtn(reg(e.ref))).join('')}</div>` : ''}
          <div class="group-label">${qq ? `${all.length} garner` : 'Alle garner'}</div>
          ${all.length ? `<div class="panel g-list">${all.map((y) => yarnBtn(reg({ id: y.id }), `<span class="g-m">${num(y.m50)} m</span>`)).join('')}</div>` : '<div class="placeholder">Ingen garner i garnkataloget passer på søgningen</div>'}
          <button class="import-row g-own" data-act="own">${I.plus}<span><b>Tilføj et garn til garnkataloget</b><span>Til garn, der ikke er i kataloget</span></span></button>
        </div>`;
      v.querySelector('[data-act="close"]').onclick = () => done(null);
      v.querySelector('[data-act="own"]').onclick = () => { mode = 'form'; draw(); };
      v.querySelectorAll('[data-key]').forEach((b) => (b.onclick = () => done(refs.get(b.dataset.key))));
      const inp = v.querySelector('#pk-q');
      inp.oninput = () => { q = inp.value; const pos = inp.selectionStart; draw(); const n = v.querySelector('#pk-q'); n.focus(); n.setSelectionRange(pos, pos); };
    }
    function drawForm() {
      v.innerHTML = `
        <div class="g-picker-bar"><button class="icon-btn" data-act="list" aria-label="Tilbage">${C.icons.back}</button><b>Tilføj et garn</b><button class="icon-btn" data-act="close" aria-label="Luk">${I.close}</button></div>
        <div class="g-picker-body" id="pk-form"></div>`;
      v.querySelector('[data-act="close"]').onclick = () => done(null);
      v.querySelector('[data-act="list"]').onclick = () => { mode = 'list'; draw(); };
      yarnForm(v.querySelector('#pk-form'), null, ownList, (y) => done({ id: y.id }));
    }
    draw();
  });
}

/* ---------- your own yarn: add, edit ---------- */

const FIB_OPTS = [['uld', 'Uld / merino'], ['alpaka', 'Alpaka'], ['bomuld', 'Bomuld'], ['mohair', 'Mohair'], ['kashmir', 'Kashmir'], ['silke', 'Silke'], ['hør', 'Hør'], ['', 'Ved ikke']];
const TYPE_OPTS = [['glat', 'Glat'], ['luftig', 'Luftig'], ['borstet', 'Børstet'], ['mohair', 'Mohair'], ['boucle', 'Bouclé']];

/**
 * The form for a yarn of your own. Saves it in the garnkatalog and calls onSaved(yarn).
 * `ownList` gives suggestions from your patterns' yarns that aren't in the catalogue.
 */
function yarnForm(root, existing, ownList, onSaved) {
  const f = existing
    ? { name: existing.name, brand: existing.brand || '', g: String(existing.skein?.g ?? 50), m: String(existing.skein?.m ?? ''),
        fibre: existing.fibre?.[0]?.fibre || '', structure: existing.structure || 'glat', sts: existing.sts ? String(existing.sts[0]) : '', needle: existing.needle ? dec(existing.needle[0]) : '' }
    : { name: '', brand: '', g: '50', m: '', fibre: '', structure: 'glat', sts: '', needle: '' };
  const fromRecipes = existing ? [] : ownList.filter((e) => e.ref.custom);
  const read = () => ['name', 'brand', 'g', 'm', 'sts', 'needle'].forEach((k) => { f[k] = root.querySelector(`#yf-${k}`).value; });
  const chips = (key, opts) => opts.map(([k, l]) => `<button class="g-fib" data-${key}="${k}" aria-pressed="${f[key] === k}">${l}</button>`).join('');
  function draw() {
    root.innerHTML = `<div class="g-form">
      ${fromRecipes.length ? `<div class="g-note">Fra dine opskrifter: ${fromRecipes.map((e) => `<button class="g-link" data-fill="${esc(e.key)}">${esc(e.ref.custom.name)}${e.ref.custom.brand ? ` fra ${esc(e.ref.custom.brand)}` : ''}</button>`).join(', ')}</div>` : ''}
      <div class="g-two"><label class="my-field"><span>Navn</span><input id="yf-name" value="${esc(f.name)}" placeholder="Fx Pernilla" autocomplete="off"></label>
        <label class="my-field"><span>Mærke</span><input id="yf-brand" value="${esc(f.brand)}" placeholder="Fx Filcolana" autocomplete="off"></label></div>
      <div class="my-field"><span>Nøgle · står på banderolen</span>
        <div class="g-ratio"><input id="yf-g" inputmode="decimal" value="${esc(f.g)}" aria-label="Gram"><span>g =</span><input id="yf-m" inputmode="decimal" value="${esc(f.m)}" aria-label="Meter"><span>m</span></div></div>
      <div class="my-field"><span>Fiber</span><div class="g-fibres">${chips('fibre', FIB_OPTS)}</div></div>
      <div class="my-field"><span>Type</span><div class="g-fibres">${chips('structure', TYPE_OPTS)}</div>
        <span class="g-hint">${f.structure === 'glat' ? 'Det almindelige, glatte garn.' : 'Skriv strikkefastheden for luftigt, børstet og mohair-garn. Deres løbelængde siger ikke meget om tykkelsen.'}</span></div>
      <div class="g-two"><label class="my-field"><span>Strikkefasthed${f.structure === 'glat' ? ' (valgfri)' : ''}</span><span class="g-unit"><input id="yf-sts" inputmode="numeric" value="${esc(f.sts)}"><em>m pr. 10 cm</em></span></label>
        <label class="my-field"><span>Pind (valgfri)</span><span class="g-unit"><input id="yf-needle" inputmode="decimal" value="${esc(f.needle)}"><em>mm</em></span></label></div>
      <button class="primary brand" id="yf-save">${existing ? 'Gem ændringer' : 'Gem i garnkataloget'}</button>
    </div>`;
    root.querySelectorAll('[data-fibre]').forEach((b) => (b.onclick = () => { read(); f.fibre = b.dataset.fibre; draw(); }));
    root.querySelectorAll('[data-structure]').forEach((b) => (b.onclick = () => { read(); f.structure = b.dataset.structure; draw(); }));
    root.querySelectorAll('[data-fill]').forEach((b) => (b.onclick = () => {
      const c = fromRecipes.find((e) => e.key === b.dataset.fill).ref.custom;
      read(); Object.assign(f, { name: c.name, brand: c.brand, g: String(c.g), m: String(c.m) }); draw();
    }));
    root.querySelector('#yf-save').onclick = async () => {
      read();
      const n = (s) => parseFloat(String(s).replace(',', '.'));
      const g = n(f.g), m = n(f.m), sts = n(f.sts), needle = n(f.needle);
      if (!f.name.trim()) { C.toast('Skriv garnets navn'); return; }
      if (!(g > 0 && m > 0)) { C.toast('Skriv nøglens vægt og længde, fx 50 g = 175 m'); return; }
      if (f.structure !== 'glat' && !(sts > 0)) { C.toast('Skriv strikkefastheden, fx 18 masker pr. 10 cm'); return; }
      const y = {
        id: existing?.id || `mine-${Date.now().toString(36)}`, own: true, created: existing?.created || Date.now(),
        brand: f.brand.trim(), name: f.name.trim(), fibre: f.fibre ? [{ pct: 100, fibre: f.fibre }] : [],
        m50: Math.round((m * 50) / g), skein: { g, m }, sts: sts > 0 ? [sts, sts] : null, needle: needle > 0 ? [needle, needle] : null,
        structure: f.structure, url: null,
      };
      await C.store.saveYarn(y);
      G.useOwnYarns(await C.store.listYarns());
      C.toast(existing ? 'Garnet er gemt' : `${y.name} er tilføjet garnkataloget`);
      onSaved(y);
    };
  }
  draw();
}

/** Page: add a yarn (#/garn/nyt) or edit one of yours (#/garn/ret/<id>). */
async function renderYarnForm(id = null) {
  const app = C.app;
  await ensure();
  const existing = id ? G.byId(id) : null;
  if (id && !existing?.own) { C.go('#/garn/katalog'); return; }
  const { list } = await mine();
  app.innerHTML = `${subHeader(existing ? 'Ret garn' : 'Tilføj et garn', existing ? existing.name : 'Til garnkataloget')}<main class="g-page" id="yf-root"></main>`;
  wireCommon(app);
  yarnForm(app.querySelector('#yf-root'), existing, list, (y) => {
    if (existing) { history.back(); return; }
    if (S.add.back) { S.add.back = false; S.alt.added = y.id; history.back(); return; }   // back to Find alternativ
    location.replace(`#/garn/y/${y.id}`);   // show the new yarn; Back goes to the catalogue
  });
}

/* ---------- Garn tab (P58) ---------- */

async function renderTab() {
  const app = C.app;
  const cat = await ensure();
  const { list } = await mine();
  const task = (href, title, sub, icon, primary = false) => `
    <button class="g-task ${primary ? 'primary-task' : ''}" data-href="${href}"><span class="g-task-ic">${icon}</span>
      <span><b>${title}</b><span>${sub}</span></span></button>`;
  const rows = list.map((e) => {
    const i = info(e.ref);
    const tags = [e.knitted.length ? tag(`Strikket ${e.knitted.length}×`, 'moss') : '', e.ref.custom ? tag('Ikke i garnkataloget', 'grey') : ''].join('');
    return `<button class="g-row" data-mine="${esc(e.key)}">${strand(i.thick, i.structure)}
      <span class="g-row-text"><b>${esc(i.name)} ${tags}</b><span>${esc(brandShort(i.brand))}${i.brand ? ' · ' : ''}${esc(e.recipes.map((x) => x.r.pattern.title).join(', '))}</span></span>${C.icons.chevronRight}</button>`;
  }).join('');
  app.innerHTML = `
    ${C.homeHeader()}
    <main class="home g-home">
      <button class="g-search-field as-btn" data-act="search">${I.search}<span>Søg i garnkataloget</span></button>
      <div class="g-tasks">
        ${task('#/garn/alternativ', 'Find alternativ', 'Til et garn du vælger', I.alt)}
        ${task('#/garn/sammenlign', 'Sammenlign', 'To garner side om side', I.swap)}
        ${task('#/garn/sammen', 'To garner sammen', 'Fx Sunday + mohair', I.two)}
        ${task('#/garn/strikke', 'Hvad kan jeg strikke?', 'Med et garn du har', I.knit)}
      </div>
      ${list.length ? `<div class="group-label">Garn i dine opskrifter · ${list.length}</div><div class="panel g-list">${rows}</div>` : ''}
      <button class="g-all" data-href="#/garn/katalog"><span><b>Hele garnkataloget</b><span>${catalogLine(cat)}</span></span>${C.icons.chevronRight}</button>
    </main>
    ${C.tabbar('garn')}`;
  C.wireHomeHeader();
  wireCommon(app);
  app.querySelector('[data-act="search"]').onclick = () => { S.kat.focus = true; C.go('#/garn/katalog'); };
  app.querySelectorAll('[data-mine]').forEach((b) => (b.onclick = () => {
    const e = list.find((x) => x.key === b.dataset.mine);
    if (e.ref.id) C.go(`#/garn/y/${e.ref.id}`);
    else { S.alt.ref = e.ref; C.go('#/garn/alternativ'); }
  }));
}

/* ---------- catalogue (P59) ---------- */

const SORTS = [['tyk', 'Tykkelse', 'Fra tyndt til tykt, grupperet efter pind'], ['navn', 'Navn', 'A–Å'], ['maerke', 'Mærke', 'Drops, Sandnes Garn'],
  ['fiber', 'Fiber', 'Uld, alpaka, bomuld …'], ['meter', 'Meter pr. 50 g', 'Flest meter først'], ['mine', 'Dine garner først', 'Dine egne og dem fra dine opskrifter']];

async function renderCatalog() {
  const app = C.app;
  const cat = await ensure();
  const { list: own } = await mine();
  const ownIds = new Set(own.filter((e) => e.ref.id).map((e) => e.ref.id));
  const k = S.kat;
  app.innerHTML = `
    ${subHeader('Garnkataloget', catalogLine(cat))}
    <main class="g-page">
      <label class="g-search-field">${I.search}<input id="kat-q" type="search" placeholder="Søg i garnkataloget" value="${esc(k.q)}" autocomplete="off"></label>
      <div class="g-filters" id="kat-f"></div>
      <div class="g-sortbar"><span id="kat-n"></span><button class="g-sortbtn" data-act="sort">${I.sort}Sortér: ${SORTS.find((s) => s[0] === k.sort)[1]}${I.down}</button></div>
      <div id="kat-list"></div>
      <button class="import-row g-addrow" data-href="#/garn/nyt">${I.plus}<span><b>Tilføj et garn</b><span>Til garn, der ikke er i garnkataloget</span></span></button>
    </main>`;
  wireCommon(app);
  const FILT = {
    brand: ['Mærke', [...Object.keys(cat.brands).map((b) => [b, b]), ...(G.ownCount() ? [['__own', 'Dine egne garner']] : [])]],
    tyk: ['Tykkelse', G.BANDS.map((b, i) => [String(i), `${b.label} · ${b.needle}`])],
    fiber: ['Fiber', G.FIBRES.map((f) => [f, f[0].toUpperCase() + f.slice(1)])],
    type: ['Type', Object.entries(G.TYPE)],
  };
  const drawFilters = () => {
    app.querySelector('#kat-f').innerHTML = Object.entries(FILT).map(([key, [lbl, opts]]) => {
      const on = k[key] != null;
      const shown = on ? opts.find((o) => o[0] === k[key])[1].split(' · ')[0] : lbl;
      return `<button class="g-filter ${on ? 'on' : ''}" data-filter="${key}">${esc(shown)}${I.down}</button>`;
    }).join('');
    app.querySelectorAll('[data-filter]').forEach((b) => (b.onclick = () => {
      const key = b.dataset.filter, [lbl, opts] = FILT[key];
      C.openSheet(lbl, [{ label: `Alle${k[key] == null ? ' ✓' : ''}`, action: () => { k[key] = null; drawFilters(); drawList(); } },
        ...opts.map(([v, l]) => ({ label: `${l}${k[key] === v ? ' ✓' : ''}`, action: () => { k[key] = v; drawFilters(); drawList(); } }))]);
    }));
  };
  const row = (y) => `<a class="g-row" href="#/garn/y/${y.id}">${strand(y.thick, y.structure)}
      <span class="g-row-text"><b>${esc(y.name)}${y.own ? ` ${tag('Dit eget', 'moss')}` : ''}${ownIds.has(y.id) ? ` ${tag('I din opskrift')}` : ''}</b><span>${esc([brandShort(y.brand), fibreShort(y)].filter(Boolean).join(' · '))}</span></span>
      <span class="g-m">${num(y.m50)} m</span></a>`;
  const drawList = () => {
    const q = k.q.trim().toLowerCase();
    let ys = cat.yarns.filter((y) => (!q || `${y.name} ${y.brand} ${fibreText(y)} ${G.TYPE[y.structure]}`.toLowerCase().includes(q))
      && (k.tyk == null || G.bandOf(y) === +k.tyk) && (k.fiber == null || G.mainFibre(y) === k.fiber || (y.fam[k.fiber] || 0) >= 30)
      && (k.type == null || y.structure === k.type) && (k.brand == null || (k.brand === '__own' ? y.own : !y.own && y.brand === k.brand)));
    const byName = (a, b) => a.name.localeCompare(b.name, 'da');
    const byThick = (a, b) => (b.thick ?? -1) - (a.thick ?? -1) || byName(a, b);
    let groups;
    if (k.sort === 'tyk') groups = [...G.BANDS.map((b, i) => [`${b.label} · ${b.needle}`, ys.filter((y) => G.bandOf(y) === i)]), ['Effekttråde', ys.filter((y) => G.bandOf(y) === G.BANDS.length)]];
    else if (k.sort === 'maerke') groups = [...Object.keys(cat.brands).map((b) => [b, ys.filter((y) => !y.own && y.brand === b)]), ['Dine egne garner', ys.filter((y) => y.own)]];
    else if (k.sort === 'fiber') groups = [...G.FIBRES, 'viskose', 'syntetisk', 'andet'].map((f) => [f[0].toUpperCase() + f.slice(1), ys.filter((y) => G.mainFibre(y) === f)]);
    else if (k.sort === 'mine') groups = [['Dine garner', ys.filter((y) => y.own || ownIds.has(y.id))], ['Øvrige garner', ys.filter((y) => !y.own && !ownIds.has(y.id))]];
    else groups = [['', ys]];
    const sorter = k.sort === 'navn' || k.sort === 'maerke' || k.sort === 'fiber' ? byName : k.sort === 'meter' ? (a, b) => b.m50 - a.m50 : byThick;
    app.querySelector('#kat-n').textContent = `${ys.length} ${ys.length === 1 ? 'garn' : 'garner'}`;
    app.querySelector('#kat-list').innerHTML = ys.length ? groups.filter(([, g]) => g.length).map(([title, g]) =>
      `${title ? `<div class="g-band">${esc(title)}</div>` : ''}<div class="panel g-list">${g.sort(sorter).map(row).join('')}</div>`).join('')
      : '<div class="placeholder">Ingen garner passer. Prøv en anden søgning, eller fjern et filter.</div>';
  };
  drawFilters();
  drawList();
  const inp = app.querySelector('#kat-q');
  inp.oninput = () => { k.q = inp.value; drawList(); };
  if (k.focus) { k.focus = false; inp.focus(); }
  app.querySelector('[data-act="sort"]').onclick = () => C.openSheet('Sortér garner', SORTS.map(([key, l, sub]) => ({
    cls: 'g-sortopt', html: `<span><b>${l}</b><span>${sub}</span></span><span class="g-radio ${k.sort === key ? 'on' : ''}"></span>`,
    action: () => { k.sort = key; renderCatalog(); },
  })));
}

/* ---------- the yarn's own page (P60) ---------- */

async function renderYarn(id) {
  const app = C.app;
  await ensure();
  const y = G.byId(id);
  if (!y) { C.go('#/garn/katalog'); return; }
  const { list, recipes } = await mine();
  const t = G.targetOf({ id });
  const alts = G.alternatives(t, { limit: 6 });
  const top = alts.slice(0, 3);
  const others = [...new Set(G.catalogYarns().map((x) => x.brand))].filter((b) => b !== y.brand && !alts.some((a) => a.yarns[0].brand === b && a.rating !== 'try'));
  const entry = list.find((e) => e.ref.id === id);
  // Patterns using this yarn, and patterns it could replace a yarn in
  const uses = entry ? entry.recipes.map((x) => x.r) : [];
  const could = [];
  for (const r of recipes) {
    if (uses.includes(r)) continue;
    let best = null;
    for (const py of r.pattern.yarn || []) {
      const ref = G.resolvePatternYarn(py);
      const s = ref && G.rateYarn(id, G.targetOf(ref));
      if (s && s.rating !== 'try' && (!best || s.score < best.s.score)) best = { s, name: info(ref).name };
    }
    if (best) could.push({ r, ...best });
  }
  const recRow = (r, sub) => `<div class="g-rec">${C.recipeThumb(r)}<span class="g-row-text"><b>${esc(r.pattern.title)}</b><span>${sub}</span></span></div>`;
  const knitted = entry ? entry.knitted : [];
  const facts = [
    y.sts ? `<span><i>Strikkefasthed</i><b>${range(y.sts)} masker</b><span>pr. 10 cm${y.needle ? ` på pind ${range(y.needle)}` : ''}</span></span>` : y.needle ? `<span><i>Pind</i><b>${range(y.needle)} mm</b><span>${y.own ? 'Din angivelse' : 'Mærkets anbefaling'}</span></span>` : '',
  ].join('');
  const domain = ((y.url || '').match(/\/\/(?:www\.)?([^/]+)/) || [])[1] || '';
  app.innerHTML = `
    ${subHeader(y.name, y.own ? [y.brand, 'Dit eget garn'].filter(Boolean).join(' · ') : y.brand)}
    <main class="g-page">
      <div class="g-facts">${strand(y.thick, y.structure, 72)}
        <div class="g-facts-grid"><span><i>Løbelængde</i><b>${num(y.m50)} m</b><span>pr. 50 g</span></span>${facts}</div></div>
      <div class="g-tags">${[fibreText(y), G.TYPE[y.structure], y.superwash === true ? 'Superwash' : y.superwash === false ? 'Ikke superwash' : '',
        y.skein ? `Nøgle: ${y.skein.g} g = ${num(y.skein.m)} m` : '', y.group ? `Garngruppe ${y.group}` : ''].filter(Boolean).map((x) => tag(x, 'plain')).join('')}</div>
      ${y.note ? `<p class="g-notep">${esc(y.note)}</p>` : ''}
      <div class="g-actions">
        <div class="g-two"><button class="g-btn" data-act="cmp">${I.swap}Sammenlign</button><button class="g-btn" data-act="sammen">${I.plus}Hold sammen</button></div>
      </div>
      ${y.structure === 'effekt' ? '' : `
      <div class="g-h2"><span>Alternativer</span>${alts.length ? `<button class="g-link" data-act="alt">Se alle ${alts.length}</button>` : ''}</div>
      ${top.length ? `<div class="panel g-list">${top.map((c) => `<a class="g-row" href="#/garn/y/${c.yarns[0].id}">${strand(c.sts, c.structure)}
        <span class="g-row-text"><b>${esc(c.yarns[0].name)}</b><span>${esc(brandShort(c.yarns[0].brand))} · ${esc(fibreShort(c.yarns[0]))} · ${num(c.m50)} m</span></span>${chip(c.rating)}</a>`).join('')}</div>`
        : '<div class="placeholder">Ingen garner i garnkataloget ligger tæt nok på</div>'}
      ${others.length ? `<p class="g-small">${esc(others.join(' og '))} har intet garn, der ligger helt så tæt på.</p>` : ''}`}
      ${uses.length || could.length ? `<div class="g-h2"><span>I dine opskrifter</span></div>
        <div class="panel g-list">${uses.map((r) => recRow(r, `Opskriften bruger ${esc(y.name)}`)).join('')}${could.map((c) => recRow(c.r, `Kan erstatte ${esc(c.name)} · ${G.RATING[c.s.rating].toLowerCase()}`)).join('')}</div>` : ''}
      ${knitted.length ? `<div class="g-h2"><span>Du har strikket med det</span></div>
        <div class="panel g-list">${knitted.map((p) => `<a class="g-rec" href="#/p/${p.id}">${C.projectThumb(p)}<span class="g-row-text"><b>${esc(p.pattern.title)}${p.finishedAt ? ` · ${esc(C.daDate(p.finishedAt, { month: 'short', year: 'numeric' }))}` : ''}</b><span>${esc(C.knitSentence(p))}</span></span>${C.icons.chevronRight}</a>`).join('')}</div>` : ''}
      ${y.own ? `<div class="g-two g-ownbtns"><button class="g-btn" data-href="#/garn/ret/${y.id}">Ret garnet</button><button class="g-btn danger" data-act="del">Slet garnet</button></div>
      <p class="g-source">Tilføjet af dig${y.created ? ` · ${esc(C.daDate(y.created, { day: 'numeric', month: 'short', year: 'numeric' }))}` : ''}</p>`
      : `<p class="g-source">Fakta fra <a href="${esc(y.url)}" target="_blank" rel="noopener">${esc(domain)} ${I.out}</a> · ${esc(C.daDate(Date.parse(G.catalogUpdated()), { day: 'numeric', month: 'short', year: 'numeric' }))}</p>`}
    </main>`;
  wireCommon(app);
  app.querySelectorAll('[data-act="alt"]').forEach((b) => (b.onclick = () => { S.alt.ref = { id }; C.go('#/garn/alternativ'); }));
  app.querySelector('[data-act="cmp"]').onclick = () => { S.cmp.a = { id }; S.cmp.b = null; C.go('#/garn/sammenlign'); };
  app.querySelector('[data-act="sammen"]').onclick = () => { S.sammen.a = { id }; S.sammen.b = null; C.go('#/garn/sammen'); };
  app.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
    if (!(await C.ask(`Slet ${y.name} fra garnkataloget? Projekter, hvor du har brugt det, beholder garnet.`, 'Slet garnet', true))) return;
    await C.store.deleteYarn(id);
    G.useOwnYarns(await C.store.listYarns());
    C.toast('Garnet er slettet');
    location.replace('#/garn/katalog');
  });
}

/* ---------- Find alternativ (P61) ---------- */

function metresOf(i, amount, unit) {
  const v = parseFloat(String(amount).replace(',', '.'));
  if (!(v > 0) || !i) return null;
  if (unit === 'm') return v;
  if (unit === 'nøgler') return i.skein ? v * i.skein.m : null;
  return (v * i.m50) / 50;
}
function need(c, metres) {
  if (!metres) return '';
  return G.skeins(c.yarns, metres).map((s) => (s.n ? `${s.n} × ${s.g} g` : '?')).join(' + ');
}
const candName = (c) => (c.yarns.length === 1 ? c.yarns[0].name : c.double ? `2 tråde ${c.yarns[0].name}` : `${c.yarns[0].name} + ${c.yarns[1].name}`);
const candSub = (c) => (c.yarns.length === 1 ? `${brandShort(c.yarns[0].brand)} · ${fibreShort(c.yarns[0])}` : brandShort(c.yarns[0].brand) + (c.yarns[0].brand !== c.yarns[c.yarns.length - 1].brand ? ` og ${brandShort(c.yarns[1].brand)}` : ''));

function resultCard(c, metres, cmpFrom, canUse = false) {
  const one = c.yarns.length === 1;
  return `<div class="g-result">
    <div class="g-result-top">${strand(c.sts, c.structure)}
      ${one ? `<a class="g-row-text" href="#/garn/y/${c.yarns[0].id}">` : '<span class="g-row-text">'}<b>${esc(candName(c))}</b><span>${esc(candSub(c))}</span>${one ? '</a>' : '</span>'}
      ${chip(c.rating)}</div>
    <div class="g-why">${esc(c.why.join(' · '))}</div>
    ${metres ? `<div class="g-need">Du skal bruge: <b>${need(c, metres)}</b></div>` : ''}
    ${(one && cmpFrom) || canUse ? `<div class="g-result-act">${canUse ? `<button class="pill brand g-cmpbtn" data-use="${esc(c.yarns.map((y) => y.id).join(','))}">${C.icons.check}Brug dette garn</button>` : ''}${one && cmpFrom ? `<button class="pill g-cmpbtn" data-cmp="${c.yarns[0].id}">${I.swap}Sammenlign${canUse ? '' : ` med ${esc(cmpFrom)}`}</button>` : ''}</div>` : ''}
  </div>`;
}

/**
 * Scenario B: opened from a project's Materialer (#/garn/til/<project id>). The pattern's yarn and
 * the metres for the chosen size are filled in, and "Brug dette garn" saves the choice as "Dit garn".
 */
async function openForProject(pid) {
  await ensure();
  const p = await C.store.getProject(pid);
  if (!p) { C.go('#/garn'); return; }
  const idx = p.pattern.yarn?.length > 1 && p.yarnChoice != null ? p.yarnChoice : 0;
  const py = (p.pattern.yarn || [])[idx];
  if (S.alt.pid !== pid || S.alt.idx !== idx || S.alt.si !== p.sizeIndex) {   // new project, yarn or size: fill in again
    const amount = p.sizeIndex != null ? C.yarnAmount({ pattern: p.pattern, sizeIndex: p.sizeIndex, yarnChoice: idx, myYarns: [] }) : null;
    const patM = amount && amount.unit.startsWith('m') ? amount.value : null;   // the pattern's metres for this size
    S.alt = { ref: py ? G.resolvePatternYarn(py) : null, amount: patM ? String(patM) : '', unit: 'm', combos: false, pid, idx, si: p.sizeIndex, patM };
  }
  return renderAlternative(p);
}

async function renderAlternative(project = null) {
  const app = C.app;
  await ensure();
  if (!project && S.alt.pid) S.alt = { ref: null, amount: '', unit: 'g', combos: false };   // left project mode
  const { list } = await mine();
  const a = S.alt, i = info(a.ref);
  const metres = metresOf(i, a.amount, a.unit);
  // Single yarns first. Two strands held together get their own section, shown only when
  // a combination is a good match ("Meget tæt på" or "Godt alternativ").
  // The yarn you chose (or added) via "Kan du ikke finde dit garn?" comes first, however well it fits
  const added = i && a.added && G.byId(a.added) && !sameRef({ id: a.added }, a.ref) ? G.byId(a.added) : null;
  const addedCard = added ? (G.rateYarn(added.id, G.targetOf(a.ref))
    || { yarns: [added], sts: added.thick, m50: added.m50, structure: added.structure, rating: 'far', why: [`Ligger langt fra ${i.name} i tykkelse. Strik en prøve, og regn med at skulle tilpasse opskriften`] }) : null;
  const res = i ? G.alternatives(G.targetOf(a.ref), { limit: 8 }).filter((c) => !added || c.yarns[0].id !== added.id) : [];
  const pairs = i ? G.alternatives(G.targetOf(a.ref), { limit: 60, withCombos: true }).filter((c) => c.yarns.length > 1 && c.rating !== 'try').slice(0, 5) : [];
  const listHtml = (m) => `${addedCard ? `<div class="g-band">Dit valgte garn</div>${resultCard(addedCard, m, i.name, !!project)}<div class="g-band">Forslag fra garnkataloget</div>` : ''}${res.length ? res.map((c) => resultCard(c, m, i.name, !!project)).join('') : (pairs.length ? '' : '<div class="placeholder">Ingen garner i garnkataloget ligger tæt nok på.</div>')}
    ${pairs.length ? `<div class="g-band">Med to tråde holdt sammen</div>${pairs.map((c) => resultCard(c, m, i.name, !!project)).join('')}` : ''}`;
  const units = ['g', 'm', ...(i?.skein ? ['nøgler'] : [])];
  app.innerHTML = `
    ${subHeader(project ? 'Vælg et alternativ' : 'Find alternativ', project ? `${project.pattern.title}` : i ? `til ${i.name} · ${num(Math.round(i.m50))} m pr. 50 g` : '')}
    <main class="g-page">
      <div class="g-label">Garnet i opskriften</div>
      ${project && !i ? '<div class="placeholder">Opskriftens garn er ikke i garnkataloget, og opskriften oplyser ikke løbelængden. Skriv dit garn under Materialer i stedet.</div>' : slot(a.ref, { act: 'pick', fixed: !!project })}
      ${i && i.custom ? `<div class="g-fibre-ask">
        <span class="g-small">${i.custom.fibre ? 'Fiber' : 'Hvilken fiber er garnet? Så bliver forslagene bedre.'}</span>
        <div class="g-fibres">${[['uld', 'Uld / merino'], ['alpaka', 'Alpaka'], ['bomuld', 'Bomuld'], ['mohair', 'Mohair'], ['kashmir', 'Kashmir']].map(([k, l]) =>
          `<button class="g-fib" data-setfib="${k}" aria-pressed="${i.custom.fibre === k}">${l}</button>`).join('')}</div></div>` : ''}
      ${i ? `
      <div class="g-amount">
        <span class="g-amount-title">Beregn hvor meget du skal bruge</span>
        <span class="g-small">${project && project.sizeIndex != null && a.patM ? `Udfyldt fra opskriften: størrelse ${esc(project.pattern.sizes[project.sizeIndex])} bruger ca. ${num(a.patM)} m ${esc(i.name)}.`
          : project ? 'Vælg en størrelse under Materialer, så udfylder Maskemakker mængden.' : `Skriv hvor meget ${esc(i.name)} opskriften bruger, så viser hvert forslag, hvor meget du skal købe.`}</span>
        <div class="g-amount-row"><input id="amt" inputmode="decimal" placeholder="Fx 200" value="${esc(a.amount)}" aria-label="Mængde ${esc(i.name)}">
          <div class="g-seg" role="group" aria-label="Enhed">${units.map((u) => `<button data-unit="${u}" aria-pressed="${a.unit === u}">${u}</button>`).join('')}</div></div>
        <span class="g-small" id="amt-m">${metres && a.unit !== 'm' ? `= ${num(Math.round(metres))} m` : ''}</span>
      </div>
      ${res.length && !addedCard ? `<div class="g-toolbar"><span>${res.length} forslag · tættest først</span></div>` : ''}
      <div class="g-results" id="alt-res">${listHtml(metres)}</div>
      <button class="import-row g-addrow" data-act="pick-own">${I.search}<span><b>Kan du ikke finde dit garn?</b><span>Søg i hele garnkataloget, eller tilføj det</span></span></button>
      <p class="g-small">Forslagene er en vejledning. Strik altid en strikkeprøve.</p>` : '<p class="g-small">Vælg garnet fra opskriften, så finder Maskemakker garner med samme tykkelse.</p>'}
    </main>`;
  wireCommon(app);
  app.querySelector('[data-act="pick"]')?.addEventListener('click', async () => {
    const ref = await pickYarn({ title: 'Garnet i opskriften', ownList: list });
    if (ref) { a.ref = ref; a.added = null; if (a.unit === 'nøgler' && !info(ref).skein) a.unit = 'g'; renderAlternative(); }
  });
  if (!i) return;
  // Any yarn in the garnkatalog (or a new one) can be chosen, however far it is from the pattern's yarn
  app.querySelector('[data-act="pick-own"]').onclick = async () => {
    const ref = await pickYarn({ title: 'Vælg dit garn', ownList: list.filter((e) => e.ref.id) });
    if (!ref?.id) return;
    a.added = ref.id;
    await renderAlternative(project);
    app.querySelector('.g-results')?.scrollIntoView({ block: 'start' });
  };
  // Yarn that isn't in the catalogue: choose its fibre right here (tap again to clear)
  app.querySelectorAll('[data-setfib]').forEach((b) => (b.onclick = () => {
    const f = b.dataset.setfib;
    a.ref = { custom: { ...a.ref.custom, fibre: a.ref.custom.fibre === f ? '' : f } };
    renderAlternative(project);
  }));
  const amt = app.querySelector('#amt');
  amt.oninput = () => {
    a.amount = amt.value;
    const m = metresOf(i, a.amount, a.unit);
    app.querySelector('#amt-m').textContent = m && a.unit !== 'm' ? `= ${num(Math.round(m))} m` : '';
    app.querySelector('#alt-res').innerHTML = listHtml(m);
    wireCmpAndUse();
  };
  // Switching unit keeps the same length: 200 g Sunday → 940 m → 4 nøgler
  app.querySelectorAll('[data-unit]').forEach((b) => (b.onclick = () => {
    const m = metresOf(i, a.amount, a.unit), u = b.dataset.unit;
    if (m) a.amount = String(u === 'm' ? Math.round(m) : u === 'g' ? Math.round((m * 50) / i.m50) : Math.round((m / i.skein.m) * 10) / 10).replace('.', ',');
    a.unit = u;
    renderAlternative(project);
  }));
  const wireCmp = () => app.querySelectorAll('[data-cmp]').forEach((b) => (b.onclick = () => {
    const m = metresOf(i, a.amount, a.unit);
    S.cmp.a = a.ref; S.cmp.b = { id: b.dataset.cmp }; if (m) S.cmp.metres = String(Math.round(m));
    C.go('#/garn/sammenlign');
  }));
  // "Brug dette garn": becomes the project's "Dit garn", then back to Materialer
  const wireUse = () => app.querySelectorAll('[data-use]').forEach((b) => (b.onclick = async () => {
    const ys = [...new Set(b.dataset.use.split(','))].map(G.byId);
    project.myYarns = ys.map((y) => ({ brand: y.brand, name: y.name, color: '', material: fibreText(y), metersPer50: String(y.m50) }));
    await C.store.saveProject(project);
    C.toast(`Dit garn er nu ${ys.map((y) => y.name).join(' + ')}`);
    C.go(`#/p/${project.id}/materialer`);
  }));
  const wireCmpAndUse = () => { wireCmp(); wireUse(); };
  wireCmpAndUse();
}

/* ---------- Sammenlign (P62) ---------- */

/** About 10 cm of knitting: one V per stitch, so a thicker yarn shows fewer, wider stitches. */
function swatch(sts, cls) {
  const W = 340, H = 84, w = W / sts, rh = w * 0.85, rows = Math.floor((H - 8) / rh);
  let d = '';
  for (let r = 0; r < rows; r++) for (let i = 0; i < sts; i++) {
    const x = i * w, y = 6 + r * rh;
    d += `M${(x + w * 0.12).toFixed(1)} ${y.toFixed(1)}L${(x + w / 2).toFixed(1)} ${(y + rh * 0.8).toFixed(1)}L${(x + w * 0.88).toFixed(1)} ${y.toFixed(1)}`;
  }
  return `<svg class="g-swatch ${cls}" viewBox="-9 0 ${W + 18} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><path d="${d}" style="stroke: currentColor" stroke-width="${(w * 0.2).toFixed(1)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function verdict(A, B) {
  const rel = (A.thick - B.thick) / Math.max(A.thick, B.thick);   // > 0: B knits fewer stitches, so B is thicker (same size both ways)
  if (Math.abs(rel) <= 0.025) return { title: `${B.name} og ${A.name} er lige tykke`, text: 'De har næsten samme tykkelse. Strik en prøve for at tjekke strikkefastheden.' };
  const thicker = rel > 0, big = Math.abs(rel) > 0.07;
  const smooth = A.structure === 'glat' && B.structure === 'glat';
  const pct = Math.round(Math.abs(1 - B.m50 / A.m50) * 100);
  const detail = smooth ? `${B.name} har ca. ${pct} % ${B.m50 < A.m50 ? 'færre' : 'flere'} meter pr. 50 g.`
    : `${B.name} strikkes som ca. ${Math.round(B.thick)} masker pr. 10 cm mod ${Math.round(A.thick)}.`;
  const advice = thicker ? 'Strik en prøve: får du færre masker på 10 cm end opskriften, så prøv en ½ mm mindre pind.'
    : 'Strik en prøve: får du flere masker på 10 cm end opskriften, så prøv en ½ mm større pind.';
  return { title: `${B.name} er ${big ? 'en del' : 'lidt'} ${thicker ? 'tykkere' : 'tyndere'}`, text: `${detail} ${advice}${Math.abs(rel) > 0.15 ? ' Forskellen er stor, så strikket kan blive en anden størrelse.' : ''}` };
}

async function renderCompare() {
  const app = C.app;
  await ensure();
  const { list } = await mine();
  const c = S.cmp, A = info(c.a), B = info(c.b);
  let body = '';
  if (A && B) {
    const v = verdict(A, B);
    const metres = parseFloat(String(c.metres).replace(',', '.')) || 0;
    const bar = (lbl, a, b) => { const mx = Math.max(a, b) * 1.1; return `<div class="g-cmp-row"><span class="g-label">${lbl}</span>
      <div class="g-bar"><span>${esc(A.name)}</span><i style="width: ${(a / mx) * 100}%" class="a"></i><b>${num(Math.round(a))} m</b></div>
      <div class="g-bar"><span>${esc(B.name)}</span><i style="width: ${(b / mx) * 100}%" class="b"></i><b>${num(Math.round(b))} m</b></div></div>`; };
    const row = (lbl, a, b) => `<div class="g-cmp-row"><span class="g-label">${lbl}${a === b ? ' · ens' : ''}</span><div class="g-cmp-two"><span>${a}</span><span>${b}</span></div></div>`;
    const gauge = (i) => (i.y?.sts ? `${range(i.y.sts)} m${i.y.needle ? ` · pind ${range(i.y.needle)}` : ''}` : '<span class="g-dim">Ukendt</span>');
    const wash = (i) => (i.custom ? '<span class="g-dim">Ukendt</span>' : i.y.superwash === true ? 'Superwash' : i.y.superwash === false ? 'Ikke superwash' : '<span class="g-dim">Kommer senere</span>');
    const fib = (i) => (i.y ? esc(fibreText(i.y)) : i.custom.fibre ? esc(i.custom.fibre) : '<span class="g-dim">Ukendt</span>');
    const sk = (i) => (metres && i.skein ? `${Math.ceil(metres / i.skein.m)} × ${i.skein.g} g` : '–');
    const brandsDiffer = A.y && B.y && A.y.brand !== B.y.brand;
    body = `
      <p class="g-small">Sådan cirka ser 10 cm ud i hvert garn</p>
      <div class="g-sw"><div class="g-sw-head"><b>${esc(A.name)}</b><span>ca. ${Math.round(A.thick)} m pr. 10 cm</span></div>${swatch(Math.round(A.thick), 'a')}</div>
      <div class="g-sw"><div class="g-sw-head"><b>${esc(B.name)}</b><span>ca. ${Math.round(B.thick)} m pr. 10 cm</span></div>${swatch(Math.round(B.thick), 'b')}</div>
      <div class="g-verdict"><b>${esc(v.title)}</b><span>${esc(v.text)}</span></div>
      <div class="panel g-cmp">
        ${bar('Meter pr. 50 g', A.m50, B.m50)}
        ${row('Mærkets strikkefasthed', gauge(A), gauge(B))}
        ${brandsDiffer ? `<p class="g-small g-inrow">${esc(A.y.brand)} og ${esc(B.y.brand)} angiver strikkefasthed forskelligt. Meter pr. 50 g er mest sammenlignelig.</p>` : ''}
        ${row('Fiber', fib(A), fib(B))}
        ${row('Type', G.TYPE[A.structure], G.TYPE[B.structure])}
        ${row('Vask', wash(A), wash(B))}
        ${row('Nøgle', A.skein ? `${A.skein.g} g = ${num(A.skein.m)} m` : '–', B.skein ? `${B.skein.g} g = ${num(B.skein.m)} m` : '–')}
        <div class="g-cmp-row"><span class="g-label">Til <input id="cmp-m" inputmode="numeric" value="${esc(c.metres)}" aria-label="Meter"> m</span><div class="g-cmp-two"><span id="sk-a">${sk(A)}</span><span id="sk-b">${sk(B)}</span></div></div>
      </div>
      <p class="g-small">Tegningen er beregnet ud fra meter pr. 50 g, ikke mærkernes egne tal.</p>`;
  } else if (A) {
    const alts = G.alternatives(G.targetOf(c.a), { limit: 5 });
    body = alts.length ? `<div class="group-label">Bedste alternativer til ${esc(A.name)}</div>
      <div class="panel g-list">${alts.map((x) => `<button class="g-row" data-quick="${x.yarns[0].id}">${strand(x.sts, x.structure)}<span class="g-row-text"><b>${esc(x.yarns[0].name)}</b><span>${esc(brandShort(x.yarns[0].brand))} · ${num(x.m50)} m pr. 50 g</span></span>${chip(x.rating)}</button>`).join('')}</div>` : '';
  } else {
    body = '<p class="g-small">Vælg to garner for at se forskellen på tykkelse, fiber, vask og hvor meget du skal købe.</p>';
  }
  app.innerHTML = `
    ${subHeader('Sammenlign')}
    <main class="g-page">
      <div class="g-pair">${slot(c.a, { act: 'pick-a', side: 'a', label: 'Vælg garn' })}
        <button class="g-swapbtn" data-act="swap" aria-label="Byt om" ${A && B ? '' : 'disabled'}>${I.swap}</button>
        ${slot(c.b, { act: 'pick-b', side: 'b', label: 'Sammenlign med' })}</div>
      ${body}
    </main>`;
  wireCommon(app);
  const pick = async (which) => {
    const other = which === 'a' ? c.b : c.a;
    const ref = await pickYarn({ title: which === 'a' ? 'Første garn' : 'Sammenlign med', ownList: list, suggest: other ? G.alternatives(G.targetOf(other), { limit: 4 }) : [] });
    if (ref) { c[which] = ref; renderCompare(); }
  };
  app.querySelector('[data-act="pick-a"]').onclick = () => pick('a');
  app.querySelector('[data-act="pick-b"]').onclick = () => pick('b');
  app.querySelector('[data-act="swap"]').onclick = () => { [c.a, c.b] = [c.b, c.a]; renderCompare(); };
  app.querySelectorAll('[data-quick]').forEach((b) => (b.onclick = () => { c.b = { id: b.dataset.quick }; renderCompare(); }));
  const m = app.querySelector('#cmp-m');
  if (m) m.oninput = () => {
    c.metres = m.value;
    const mm = parseFloat(m.value) || 0;
    app.querySelector('#sk-a').textContent = mm && A.skein ? `${Math.ceil(mm / A.skein.m)} × ${A.skein.g} g` : '–';
    app.querySelector('#sk-b').textContent = mm && B.skein ? `${Math.ceil(mm / B.skein.m)} × ${B.skein.g} g` : '–';
  };
}

/* ---------- To garner sammen (P63) ---------- */

async function renderTogether() {
  const app = C.app;
  await ensure();
  const { list } = await mine();
  const s = S.sammen, A = info(s.a), B = info(s.b);
  const t = A && B ? G.targetOf(s.a, s.b) : null;
  const metres = parseFloat(String(s.metres).replace(',', '.')) || 0;
  const res = t ? G.alternatives(t, { limit: 8 }) : [];
  app.innerHTML = `
    ${subHeader('To garner sammen')}
    <main class="g-page">
      <div class="g-pair together">${slot(s.a, { act: 'pick-a', side: 'a', label: 'Første garn' })}<b class="g-plus">+</b>${slot(s.b, { act: 'pick-b', side: 'a', label: 'Holdt sammen med' })}</div>
      ${t ? `
      <div class="g-info">${strand(t.sts, t.structure, 48)}<span>Holdt sammen strikker de som <b>ca. ${Math.round(t.sts)} masker pr. 10 cm</b>.</span></div>
      <div class="g-toolbar"><span>Til <input id="tg-m" class="g-inline" inputmode="numeric" value="${esc(s.metres)}" aria-label="Meter"> m af hver tråd</span></div>
      <div class="g-results" id="tg-res">${res.length ? res.map((c) => resultCard(c, metres, false)).join('') : '<div class="placeholder">Ingen garner i garnkataloget ligger tæt nok på</div>'}</div>
      <p class="g-small">Hver tråd skal bruge hele længden. Strik altid en strikkeprøve.</p>`
      : '<p class="g-small">Vælg de to garner, opskriften strikker sammen, fx Sunday + Tynn Silk Mohair. Så finder Maskemakker andre garner eller par med samme tykkelse.</p>'}
    </main>`;
  wireCommon(app);
  const pick = async (which) => {
    const ref = await pickYarn({ title: which === 'a' ? 'Første garn' : 'Holdt sammen med', ownList: list });
    if (ref) { s[which] = ref; renderTogether(); }
  };
  app.querySelector('[data-act="pick-a"]').onclick = () => pick('a');
  app.querySelector('[data-act="pick-b"]').onclick = () => pick('b');
  const m = app.querySelector('#tg-m');
  if (m) m.oninput = () => {
    s.metres = m.value;
    const mm = parseFloat(m.value) || 0;
    app.querySelector('#tg-res').innerHTML = res.map((c) => resultCard(c, mm, false)).join('');
  };
}

/* ---------- Hvad kan jeg strikke? (P64) ---------- */

/** Skeins of a yarn for every size of a pattern, e.g. "4–9 × 50 g". */
function skeinRange(r, yarnIdx, i) {
  if (!i.skein) return '';
  const ns = r.pattern.sizes.map((_, si) => {
    const a = C.yarnAmount({ pattern: r.pattern, sizeIndex: si, yarnChoice: yarnIdx, myYarns: [] });
    return a && a.unit.startsWith('m') ? Math.ceil(a.value / i.skein.m) : null;
  }).filter((n) => n != null);
  if (!ns.length) return '';
  const lo = Math.min(...ns), hi = Math.max(...ns);
  return `${lo === hi ? lo : `${lo}–${hi}`} × ${i.skein.g} g${r.pattern.sizes.length > 1 ? ' afhængigt af størrelse' : ''}`;
}

async function renderKnit() {
  const app = C.app;
  await ensure();
  const { list, recipes } = await mine();
  const s = S.strikke, i = info(s.a);
  let body = '';
  if (i) {
    const fit = [], maybe = [], no = [];
    for (const r of recipes) {
      let best = null;
      (r.pattern.yarn || []).forEach((py, idx) => {
        const ref = G.resolvePatternYarn(py);
        if (!ref) return;
        const t = G.targetOf(ref);
        const sc = sameRef(ref, s.a) ? { rating: 'same', score: -1 } : s.a.id ? G.rateYarn(s.a.id, t) : G.rateRef(s.a, t);
        const thin = info(ref).thick > i.thick;   // pattern yarn knits more stitches → thinner than yours
        if (!best || (sc && (!best.sc || sc.score < best.sc.score))) best = { sc, idx, name: info(ref).name, thin };
      });
      if (!best) continue;
      if (best.sc && best.sc.rating !== 'try') fit.push({ r, ...best });
      else if (best.sc) maybe.push({ r, ...best });
      else no.push({ r, ...best });
    }
    const card = (x) => `<div class="g-rec">${C.recipeThumb(x.r)}<span class="g-row-text"><b>${esc(x.r.pattern.title)}</b>
      <span>${x.sc.rating === 'same' ? 'Opskriftens eget garn' : `I stedet for ${esc(x.name)}`}${skeinRange(x.r, x.idx, i) ? ` · ${skeinRange(x.r, x.idx, i)}` : ''}</span>${chip(x.sc.rating)}</span></div>`;
    body = `
      ${fit.length ? `<div class="group-label">Passer til ${fit.length} af dine opskrifter</div><div class="panel g-list">${fit.map(card).join('')}</div>` : '<div class="placeholder">Garnet passer ikke til nogen af dine opskrifter</div>'}
      ${maybe.length ? `<div class="group-label">Måske · strik en prøve</div><div class="panel g-list">${maybe.map(card).join('')}</div>` : ''}
      ${no.length ? `<div class="group-label">Passer ikke</div><div class="panel g-plain">${no.map((x) => `<p><b>${esc(x.r.pattern.title)}</b> bruger ${esc(x.name)}, som er ${x.thin ? 'tyndere' : 'tykkere'}.</p>`).join('')}</div>` : ''}`;
  } else {
    body = '<p class="g-small">Vælg et garn, du har eller kunne tænke dig, så viser Maskemakker, hvilke af dine opskrifter det passer til.</p>';
  }
  app.innerHTML = `
    ${subHeader('Hvad kan jeg strikke?')}
    <main class="g-page">
      <div class="g-label">Garnet du vil strikke med</div>
      ${slot(s.a, { act: 'pick' })}
      ${body}
    </main>`;
  wireCommon(app);
  app.querySelector('[data-act="pick"]').onclick = async () => {
    const ref = await pickYarn({ title: 'Garnet du vil strikke med', ownList: list });
    if (ref) { s.a = ref; renderKnit(); }
  };
}

/* ---------- routing ---------- */

/** Handles #/garn and everything under it. Returns a promise, or null when the hash isn't ours. */
export function route(hash) {
  const m = hash.match(/^#\/garn(?:\/([\w-]+))?(?:\/([\w-]+))?$/);
  if (!m) return null;
  C.releaseWakeLock();
  const run = (fn) => fn().catch((err) => {
    C.app.innerHTML = `${subHeader('Garn')}<main class="g-page"><div class="placeholder">Garnkataloget kunne ikke hentes. Tjek din internetforbindelse og prøv igen.<br><small>${esc(err.message)}</small></div></main>`;
    wireCommon(C.app);
  });
  switch (m[1]) {
    case undefined: return run(renderTab);
    case 'katalog': return run(renderCatalog);
    case 'y': return run(() => renderYarn(m[2]));
    case 'alternativ': return run(() => renderAlternative());
    case 'til': return run(() => openForProject(m[2]));
    case 'nyt': return run(() => renderYarnForm());
    case 'ret': return run(() => renderYarnForm(m[2]));
    case 'sammenlign': return run(renderCompare);
    case 'sammen': return run(renderTogether);
    case 'strikke': return run(renderKnit);
    default: C.go('#/garn'); return Promise.resolve();
  }
}
