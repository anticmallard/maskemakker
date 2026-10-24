// app.js — Maskemakker: screens and interaction. All saving goes through storage.js.
import * as store from './storage.js';

const app = document.getElementById('app');
const fileInput = document.getElementById('file-input');
const photoInput = document.getElementById('photo-input');
const sheet = document.getElementById('sheet');

const TABS = ['materialer', 'teknikker', 'opskrift'];

/* ---------- helpers ---------- */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/**
 * Turns pattern text into HTML:
 *  {88|100|112}              → the number for the chosen size (all of them if none chosen)
 *  [[udt]] [[indt-r|Indt-r]] → a tappable technique (opens the Teknikker tab)
 *  [Video](https://…)        → a live link
 *  **tekst**                 → bold
 */
function renderText(text, sizeIndex, techs) {
  let h = esc(text);
  h = h.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, inner) => {
    const vals = inner.split('|').map((v) => v.trim());
    if (sizeIndex == null) return `<span class="num all">${vals.join(' / ')}</span>`;
    const v = vals[sizeIndex] ?? vals[vals.length - 1];
    return `<span class="num">${v === '-' ? '–' : v}</span>`;
  });
  h = h.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, id, shown) => {
    const key = id.trim();
    const label = shown ?? id;
    return techs && techs[key] ? `<a class="term" href="#tech" data-tech="${key}">${label}</a>` : label;
  });
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_, t, u) => `<a href="${u}" target="_blank" rel="noopener" class="link">${playIcon}${t}</a>`);
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return h;
}

/** Plain text version (for small labels): one size value, no markup. */
const plain = (s, si) => String(s ?? '')
  .replace(/\{([^{}]*)\}/g, (_, x) => { const v = x.split('|'); return (v[si ?? 0] ?? v[0]).trim(); })
  .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, id, shown) => shown ?? id)
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/\*\*/g, '');

/** Does this item (or section) apply to the chosen size? */
const applies = (thing, si) => !thing.sizes || si == null || thing.sizes.includes(si);
const isRow = (it) => it.type === 'row' || it.type === 'measure';

/**
 * Every tickable row for the project's chosen size, in order.
 * Rows inside a repeat block get `repeat` (the block); every row gets `sec` (its section index).
 */
function visibleRows(project) {
  const si = project.sizeIndex;
  const rows = [];
  project.pattern.sections.forEach((sec, secIdx) => {
    if (!applies(sec, si)) return;
    for (const it of sec.items) {
      if (!applies(it, si)) continue;
      if (it.type === 'repeat') {
        let ri = 0;
        for (const r of it.items) if (isRow(r) && applies(r, si)) rows.push({ ...r, repeat: it, ri: ri++, sec: secIdx });
        if (it.until) rows.push({ ...it.until, sec: secIdx });
      } else if (isRow(it)) {
        rows.push({ ...it, sec: secIdx });
      }
    }
  });
  return rows;
}

const repsOf = (project, rep) => project.reps?.[rep.id] || 0;

/**
 * Running P number for a row in a numbered repeat block ("numberFrom"): the numbers keep
 * counting with each repeat, e.g. P 16–23 in the first, P 24–31 in the second.
 */
/** A number that may differ per size, e.g. "{22|27}" → 22 or 27. */
const sizedInt = (v, si) => (v == null ? null : parseInt(plain(String(v), si), 10));
const blockRowsOf = (rep, si) => rep.items.filter((r) => isRow(r) && applies(r, si));
/** How many times a repeat block is knitted, when the pattern says so ("times"); else null. */
const repTimes = (rep, si) => sizedInt(rep.times, si);

const repNumber = (project, rep, ri) =>
  sizedInt(rep.numberFrom, project.sizeIndex) + repsOf(project, rep) * blockRowsOf(rep, project.sizeIndex).length + ri;

/** The short label shown for a row outside the recipe list (home card, progress card, back button). */
const repPrefix = (rep) => rep.numberPrefix || 'P';
const displayLabel = (project, r) =>
  r.repeat && r.repeat.numberFrom != null ? `${repPrefix(r.repeat)} ${repNumber(project, r.repeat, r.ri)}` : shortLabel(r.label || '', project.sizeIndex);

/**
 * Row marks, e.g. buttonholes: { label: "Knaphul", tech: "knaphul", first: 4, every: "{24|26}", count: "{8|8}" }
 * marks P 4, P 28, P 52 … (8 in total). Only rows numbered "P n" are checked.
 */
function marksFor(pattern, si, n) {
  if (n == null) return [];
  return (pattern.rowMarks || []).filter((m) => {
    const first = sizedInt(m.first, si), every = sizedInt(m.every, si), count = sizedInt(m.count, si);
    if (n < first) return false;
    const k = (n - first) / every;
    return Number.isInteger(k) && (count == null || k < count);
  });
}
/** The P number of a row, if it has one. */
function rowNumber(project, r, rep, ri) {
  if (rep && rep.numberFrom != null) return repPrefix(rep) === 'P' ? repNumber(project, rep, ri) : null;
  const m = plain(r.label || '', project.sizeIndex).match(/^P (\d+)$/);
  return m ? +m[1] : null;
}

/**
 * Is this row done? Rows in a repeat block are cleared at each "Ny gentagelse", so for the
 * progress bar they count as done once one repeat is finished. For "next row" they only
 * count when actually ticked (or the repeats are finished).
 */
function rowDone(project, r, forProgress) {
  const t = r.repeat ? repTimes(r.repeat, project.sizeIndex) : null;
  if (t) {
    // Fixed number of repeats: while more repeats remain and the block is all ticked,
    // the "next row" is the block's first row (where "Ny gentagelse" sits).
    if (!project.done[r.id]) return false;
    const n = repsOf(project, r.repeat);
    const all = blockRowsOf(r.repeat, project.sizeIndex).every((x) => project.done[x.id]);
    return !(r.ri === 0 && all && n < t - 1 && !forProgress);
  }
  if (project.done[r.id]) return true;
  if (r.repeat) {
    if (r.repeat.until && project.done[r.repeat.until.id]) return true;
    if (forProgress && repsOf(project, r.repeat) > 0) return true;
  }
  return false;
}

/**
 * How much a row counts towards progress: a row in a block knitted a fixed number of times
 * counts once per repeat (8 rows × 22 repeats = 176 rows); everything else counts once.
 */
function rowStats(project, r) {
  const t = r.repeat ? repTimes(r.repeat, project.sizeIndex) : null;
  if (t) return { w: t, d: Math.min(repsOf(project, r.repeat) + (project.done[r.id] ? 1 : 0), t) };
  return { w: 1, d: rowDone(project, r, true) ? 1 : 0 };
}

function progress(project) {
  const rows = visibleRows(project);
  let done = 0, total = 0;
  for (const r of rows) { const st = rowStats(project, r); done += st.d; total += st.w; }
  const next = rows.find((r) => !rowDone(project, r, false));
  return { rows, done, total, pct: total ? Math.round((done / total) * 100) : 0, next };
}

const isStarted = (p) => !!p.started;
/** A project is finished when you tap "Jeg er færdig!" at the bottom of the recipe. */
const isFinished = (p) => !!p.finished;
const isFinishedFlag = isFinished;
const photoOf = (p) => p.photo || p.pattern.photo || null;

/** Techniques as a map by id. */
const techMap = (pattern) => Object.fromEntries((pattern.techniques || []).map((t) => [t.id, t]));
const shortLabel = (l, si) => plain(l, si).split('·')[0].trim();

/** Where each technique is used, e.g. "Udtagninger P 1, P 5 · Baghoved Omg 3". */
function techUsage(pattern, si) {
  const usage = {};
  pattern.sections.forEach((sec) => {
    if (!applies(sec, si)) return;
    const visit = (it) => {
      if (!applies(it, si)) return;
      const s = `${it.label || ''} ${it.text || ''}`;
      for (const m of s.matchAll(/\[\[([^\]|]+)/g)) {
        const id = m[1].trim();
        const bySec = (usage[id] ||= new Map());
        if (!bySec.has(sec.title)) bySec.set(sec.title, []);
        const lbl = it.label ? shortLabel(it.label, si) : '';
        if (lbl && !bySec.get(sec.title).includes(lbl)) bySec.get(sec.title).push(lbl);
      }
    };
    sec.items.forEach((it) => {
      visit(it);
      if (it.type === 'repeat') { it.items.forEach(visit); if (it.until) visit(it.until); }
    });
  });
  const out = {};
  for (const [id, bySec] of Object.entries(usage)) {
    out[id] = [...bySec].map(([t, lbls]) => (lbls.length ? `${t} ${lbls.join(', ')}` : t)).join(' · ');
  }
  return out;
}

/** Checks an imported pattern file and gives every item a stable id. */
function normalizePattern(p) {
  if (!p || typeof p !== 'object' || !p.title || !Array.isArray(p.sections)) {
    throw new Error('Filen ligner ikke en opskrift.');
  }
  if (!Array.isArray(p.sizes) || !p.sizes.length) p.sizes = ['Én størrelse'];
  p.sections.forEach((sec, si) => {
    sec.items = sec.items || [];
    sec.items.forEach((it, ii) => {
      it.id = it.id || `s${si}-i${ii}`;
      it.type = it.type || 'row';
      if (it.type === 'repeat') {
        it.items = it.items || [];
        it.items.forEach((r, ri) => { r.id = r.id || `${it.id}-r${ri}`; r.type = r.type || 'row'; });
        if (typeof it.until === 'string') it.until = { type: 'measure', label: 'Til mål', text: it.until };
        if (it.until) { it.until.id = it.until.id || `${it.id}-until`; it.until.type = it.until.type || 'measure'; }
      }
    });
  });
  return p;
}

function toast(msg, ms = 2200) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

/* ---------- bottom sheet (menus and confirmations) ---------- */

function openSheet(title, buttons, onDismiss) {
  sheet.innerHTML = `
    <div class="sheet-inner">
      <div class="sheet-title">${esc(title)}</div>
      ${buttons.map((b, i) => `<button class="sheet-btn ${b.cls || ''}" data-i="${i}">${b.html ?? esc(b.label)}</button>`).join('')}
      <button class="sheet-btn cancel" data-i="-1">Annullér</button>
    </div>`;
  const dismiss = () => { sheet.close(); onDismiss?.(); };
  sheet.oncancel = (e) => { e.preventDefault(); dismiss(); };
  sheet.onclick = (e) => {
    if (e.target === sheet) return dismiss();
    const btn = e.target.closest('[data-i]');
    if (!btn) return;
    const b = buttons[+btn.dataset.i];
    if (!b) return dismiss();
    sheet.close();
    b.action();
  };
  if (sheet.open) sheet.close();
  sheet.showModal();
}

/** In-app "are you sure?" — resolves true or false. */
function ask(question, label, danger = false) {
  return new Promise((resolve) => {
    openSheet(question, [{ label, cls: danger ? 'danger' : '', action: () => resolve(true) }], () => resolve(false));
  });
}

/* ---------- import, photos, backup ---------- */

function pickFile() { fileInput.value = ''; fileInput.click(); }

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.kind === 'strik-backup') {
      for (const p of data.projects) await store.saveProject(p);
      toast(`${data.projects.length} projekt(er) gendannet`);
      route();
      return;
    }
    const project = await createProject(normalizePattern(data));
    go(`#/p/${project.id}`);
  } catch (err) {
    toast('Kunne ikke importere filen: ' + err.message, 4500);
  }
});

async function createProject(pattern) {
  return store.saveProject({
    id: uid(),
    pattern,
    sizeIndex: pattern.sizes.length === 1 ? 0 : null,
    done: {},
    have: {},
    reps: {},
    started: false,
    created: Date.now(),
  });
}

async function loadExample() {
  try {
    const res = await fetch('patterns/eksempel.json', { cache: 'no-store' });
    const project = await createProject(normalizePattern(await res.json()));
    go(`#/p/${project.id}`);
  } catch {
    toast('Kunne ikke hente eksemplet.');
  }
}

let photoTarget = null;
function pickPhoto(project) { photoTarget = project; photoInput.value = ''; photoInput.click(); }

photoInput.addEventListener('change', async () => {
  const file = photoInput.files[0];
  if (!file || !photoTarget) return;
  try {
    photoTarget.photo = await shrinkImage(file, 600);
    await store.saveProject(photoTarget);
    toast('Billede gemt');
    route();
  } catch {
    toast('Kunne ikke læse billedet.');
  }
});

/** Shrinks a photo to max 600 px so it fits comfortably in storage. */
function shrinkImage(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function exportBackup() {
  const projects = await store.listProjects();
  const json = JSON.stringify({ kind: 'strik-backup', exported: new Date().toISOString(), projects }, null, 2);
  const name = `maskemakker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- home screen ---------- */

async function renderHome() {
  releaseWakeLock();
  const projects = await store.listProjects();
  const active = projects.filter((p) => !isFinished(p));
  const finished = projects.filter(isFinished);

  const card = (p) => {
    const pr = progress(p);
    const si = p.sizeIndex;
    const photo = photoOf(p);
    const nextSec = pr.next ? p.pattern.sections[pr.next.sec]?.title : '';
    const meta = si == null
      ? 'Størrelse ikke valgt'
      : isFinished(p) ? `${esc(p.pattern.sizes[si])} · Færdig`
      : `${esc(p.pattern.sizes[si])}${isStarted(p) && pr.next ? ` · ${esc(nextSec)} ${esc(displayLabel(p, pr.next))}` : ''}`;
    return `
      <a class="card" href="#/p/${p.id}">
        <div class="card-pic ${photo ? '' : 'empty'}">
          ${photo ? `<img src="${photo}" alt="">` : `<img class="knot-faded" src="icons/knot.png" alt=""><span class="add-pic">Tilføj billede</span>`}
          ${isFinished(p) ? '<span class="pct-badge">Færdig</span>' : isStarted(p) ? `<span class="pct-badge">${pr.pct}%</span>` : '<span class="new-badge">Ny</span>'}
        </div>
        <div class="card-body">
          <div class="card-title">${esc(p.pattern.title)}</div>
          <div class="card-meta">${meta}</div>
          <div class="bar"><div style="width:${pr.pct}%"></div></div>
        </div>
      </a>`;
  };

  app.innerHTML = `
    <header class="brandbar">
      <img class="brand-knot" src="icons/knot.png" alt="">
      <h1 class="wordmark">Maskemakker</h1>
      <button class="icon-btn on-brand" id="home-menu" aria-label="Menu">${dotsIcon}</button>
    </header>
    <main class="home">
      ${projects.length ? `
        <div class="group-label">I gang · ${active.length}</div>
        ${active.length ? `<div class="cards">${active.map(card).join('')}</div>` : '<div class="placeholder">Ingen projekter i gang</div>'}
        <div class="group-label">Færdige · ${finished.length}</div>
        ${finished.length ? `<div class="cards">${finished.map(card).join('')}</div>` : '<div class="placeholder">Færdige projekter samles her</div>'}
      ` : `
        <div class="empty">
          <img class="empty-knot" src="icons/knot.png" alt="">
          <h2>Ingen projekter endnu</h2>
          <p>Importér en opskrift for at komme i gang.</p>
          <button class="link-btn" id="example">Prøv med en eksempelopskrift</button>
        </div>`}
    </main>
    <div class="dock"><button class="primary" id="import">＋ Importér opskrift</button></div>`;

  app.querySelector('#import').onclick = pickFile;
  app.querySelector('#example')?.addEventListener('click', loadExample);
  app.querySelector('#home-menu').onclick = () => openSheet('Maskemakker', [
    { label: 'Importér opskrift', action: pickFile },
    { label: 'Gem backup af alle projekter', action: exportBackup },
    { label: 'Tilføj eksempelopskrift', action: loadExample },
  ]);
}

/* ---------- project screen ---------- */

// Remember where you were in the recipe while you look at another tab.
const recipeScroll = {};
let focusTech = null;   // technique tapped in the recipe
let fromRow = null;     // the row it was tapped from
let returnTo = null;    // row to scroll to when coming back from Teknikker
let scrollToFinish = false; // finished project opened from home → show the finish block

async function renderProject(id, tab) {
  const project = await store.getProject(id);
  if (!project) { go('#/'); return; }
  // Older projects (before the tabs existed) count as started once a size was chosen.
  if (project.started === undefined) project.started = project.sizeIndex != null;
  project.have = project.have || {};

  if (!TABS.includes(tab)) {
    if (isFinished(project)) { tab = 'opskrift'; scrollToFinish = true; }
    else tab = isStarted(project) && project.sizeIndex != null ? 'opskrift' : 'materialer';
  }

  const pat = project.pattern;
  const si = project.sizeIndex;
  const techs = techMap(pat);
  const pr = progress(project);
  const photo = photoOf(project);
  const nTech = (pat.techniques || []).length;

  const tile = (key, label, icon, sub) => `
    <a class="tile ${tab === key ? 'on' : ''}" href="#/p/${id}/${key}" ${tab === key ? 'aria-current="page"' : ''}>
      ${icon}<span class="tile-label">${label}</span><span class="tile-sub">${sub}</span>
    </a>`;

  app.innerHTML = `
    <header class="brandbar project">
      <div class="proj-bar">
        <a class="icon-btn on-brand" href="#/" aria-label="Tilbage">${backIcon}</a>
        ${photo ? `<img class="proj-thumb" src="${photo}" alt="">` : `<span class="proj-thumb empty"><img src="icons/knot.png" alt=""></span>`}
        <div class="proj-title">${esc(pat.title)}</div>
        <button class="icon-btn on-brand" id="proj-menu" aria-label="Menu">${dotsIcon}</button>
      </div>
      <nav class="tiles">
        ${tile('materialer', 'Materialer', yarnIcon, si == null ? 'Ikke valgt' : esc(pat.sizes[si]))}
        ${tile('opskrift', 'Opskrift', listIcon, isFinishedFlag(project) ? 'Færdig' : !isStarted(project) ? 'Ikke startet' : `${pr.done} af ${pr.total} · ${pr.pct}%`)}
        ${tile('teknikker', 'Teknikker', bookIcon, nTech ? `${nTech} i opskriften` : 'Ingen')}
      </nav>
    </header>
    <main class="proj" id="tab-body"></main>`;

  const body = app.querySelector('#tab-body');
  if (tab === 'materialer') renderMaterials(body, project);
  if (tab === 'teknikker') renderTechniques(body, project);
  if (tab === 'opskrift') renderRecipe(body, project, techs);

  app.querySelector('#proj-menu').onclick = () => projectMenu(project, tab);

  if (store.getSetting('wakeLock', false)) requestWakeLock();
}

/* ----- Materialer tab ----- */

function renderMaterials(body, project) {
  const pat = project.pattern;
  const si = project.sizeIndex;
  const details = pat.sizeDetails || [];
  const started = isStarted(project);

  const sizeBtns = pat.sizes.map((s, i) => `
    <button class="size-btn ${i === si ? 'on' : ''}" data-size="${i}">
      <b>${esc(s)}</b>${details[i] ? `<span>${esc(details[i])}</span>` : ''}
    </button>`).join('');

  // Older pattern files: one plain list
  const materials = !pat.yarn && !pat.needles ? (pat.materials || []).map((m) => `
    <div class="list-row">${renderText(m.text, si)}</div>`).join('') : '';

  // Yarn: when the pattern suggests several, you pick the one you use
  const yarnOpts = pat.yarn || [];
  const yarnHtml = yarnOpts.length > 1 ? `
    <p class="hint top">Opskriften foreslår ${yarnOpts.length} garner. Vælg det, du bruger.</p>
    <div class="choice-list" role="radiogroup">
      ${yarnOpts.map((y, i) => `
        <button class="choice ${project.yarnChoice === i ? 'on' : ''}" data-yarn="${i}" role="radio" aria-checked="${project.yarnChoice === i}">
          <span class="radio"></span>
          <span class="choice-body"><b>${esc(y.name)}</b>${y.text ? `<span>${renderText(y.text, si)}</span>` : ''}</span>
        </button>`).join('')}
    </div>` : yarnOpts.length === 1 ? `
    <div class="panel"><div class="list-row"><b>${esc(yarnOpts[0].name)}</b>${yarnOpts[0].text ? `<br>${renderText(yarnOpts[0].text, si)}` : ''}</div></div>` : '';

  // Needles: the pattern's needle stays visible; you can record that you use another size
  project.needles = project.needles || {};
  const sizeChoices = ['2 mm', '2,25 mm', '2,5 mm', '2,75 mm', '3 mm', '3,25 mm', '3,5 mm', '3,75 mm', '4 mm', '4,5 mm', '5 mm', '5,5 mm', '6 mm', '6,5 mm', '7 mm', '8 mm', '9 mm', '10 mm', '12 mm'];
  const needleHtml = (pat.needles || []).map((n, i) => {
    const mine = project.needles[i];
    return `
      <div class="needle-row ${mine ? 'changed' : ''}">
        <div class="needle-text">
          ${mine ? `<span class="needle-label">Opskriften</span>` : ''}
          <span class="${mine ? 'needle-orig' : ''}">${renderText(n.text, si)}</span>
          ${mine ? `<span class="needle-mine">Du bruger: <b>${esc(mine)}</b></span>` : ''}
        </div>
        <label class="needle-pick">
          <span class="sr-only">Pindestørrelse du bruger</span>
          <select data-needle="${i}">
            <option value="">${mine ? 'Som opskriften' : 'Anden pind?'}</option>
            ${sizeChoices.map((sz) => `<option ${sz === mine ? 'selected' : ''}>${sz}</option>`).join('')}
          </select>
        </label>
      </div>`;
  }).join('');
  const anyNeedleChanged = Object.keys(project.needles).length > 0;

  const gauge = (pat.gauge || []).map((g) => `
    <div class="gauge-cell"><span>${esc(g.label)}</span><b>${renderText(g.text, si)}</b></div>`).join('');

  // Older pattern files keep yarn and needles in "info"
  const info = !pat.materials && pat.info ? pat.info.map((r) =>
    `<div class="info-row"><dt>${esc(r.label)}</dt><dd>${renderText(r.text, si)}</dd></div>`).join('') : '';

  const hint = [
    pat.sizeDetailLabel && details.length ? `Cm = ${pat.sizeDetailLabel.toLowerCase()}.` : '',
    started ? 'Skifter du størrelse, skifter alle tal i opskriften med.' : '',
  ].filter(Boolean).join(' ');

  body.innerHTML = `
    <div class="tab-pad">
      ${!started ? `
        <h2 class="tab-title">Klar til at slå op?</h2>
        <p class="tab-lead">Vælg størrelse først. Så viser opskriften og garnmængden kun dine tal.</p>` : ''}
      ${pat.sizes.length > 1 ? `
        <h3 class="block-title">Størrelse</h3>
        <div class="size-grid">${sizeBtns}</div>
        ${hint ? `<p class="hint">${hint}</p>` : ''}` : ''}
      ${materials ? `<h3 class="block-title">Garn og pinde</h3><div class="panel">${materials}</div>` : ''}
      ${yarnHtml ? `<h3 class="block-title">Garn</h3>${yarnHtml}` : ''}
      ${(pat.notions || []).length ? `<h3 class="block-title">Tilbehør</h3><div class="panel">${pat.notions.map((n) => `<div class="list-row">${renderText(n.text, si)}</div>`).join('')}</div>` : ''}
      ${needleHtml ? `<h3 class="block-title">Pinde</h3><div class="panel">${needleHtml}</div>
        ${anyNeedleChanged ? '<p class="hint">Opskriften ændrer sig ikke, når du bruger en anden pind. Tjek gerne strikkefastheden.</p>' : ''}` : ''}
      ${gauge ? `<h3 class="block-title">Strikkefasthed</h3><div class="panel gauge">${gauge}</div>` : ''}
      ${(pat.tips || []).length ? `<h3 class="block-title">Tips</h3>${pat.tips.map((t) => `<div class="panel tip">${t.title ? `<b>${esc(t.title)}</b>` : ''}<p>${renderText(t.text, si)}</p></div>`).join('')}` : ''}
      ${info ? `<h3 class="block-title">Garn, pinde og strikkefasthed</h3><dl class="panel info">${info}</dl>` : ''}
      ${pat.intro ? `<h3 class="block-title">Om opskriften</h3><p class="intro">${pat.designer ? `<span class="designer">${esc(pat.designer)}</span><br>` : ''}${renderText(pat.intro, si)}</p>` : ''}
      <div class="end-space"></div>
    </div>
    ${!started ? `<div class="dock"><button class="primary brand" id="start" ${si == null ? 'disabled' : ''}>${si == null ? 'Vælg størrelse for at starte' : 'Start strikning →'}</button></div>` : ''}`;

  body.querySelectorAll('[data-size]').forEach((b) => b.onclick = async () => {
    const y = window.scrollY;
    project.sizeIndex = +b.dataset.size;
    await store.saveProject(project);
    await renderProject(project.id, 'materialer');
    window.scrollTo(0, y);
  });
  body.querySelectorAll('[data-have]').forEach((c) => c.onchange = async () => {
    if (c.checked) project.have[c.dataset.have] = true; else delete project.have[c.dataset.have];
    await store.saveProject(project);
  });
  body.querySelectorAll('[data-yarn]').forEach((b) => b.onclick = async () => {
    const i = +b.dataset.yarn;
    project.yarnChoice = project.yarnChoice === i ? undefined : i;   // tap again to unselect
    const y = window.scrollY;
    await store.saveProject(project);
    await renderProject(project.id, 'materialer');
    window.scrollTo(0, y);
  });
  body.querySelectorAll('[data-needle]').forEach((sel) => sel.onchange = async () => {
    const i = sel.dataset.needle;
    const orig = plain((pat.needles[i] || {}).size || '', si);
    if (!sel.value || sel.value === orig) delete project.needles[i];
    else project.needles[i] = sel.value;
    const y = window.scrollY;
    await store.saveProject(project);
    await renderProject(project.id, 'materialer');
    window.scrollTo(0, y);
  });
  body.querySelector('#start')?.addEventListener('click', async () => {
    project.started = true;
    await store.saveProject(project);
    go(`#/p/${project.id}/opskrift`);
  });
}

/* ----- Teknikker tab ----- */

function renderTechniques(body, project) {
  const pat = project.pattern;
  const si = project.sizeIndex;
  const usage = techUsage(pat, si);
  const list = pat.techniques || [];
  const focus = focusTech;
  const back = fromRow && focus
    ? `<a class="pill brand" href="#/p/${project.id}/opskrift" data-back>← Tilbage til ${esc(displayLabel(project, fromRow) || 'pinden')}</a>` : '';

  body.innerHTML = `
    <div class="tab-pad">
      ${list.length ? list.map((t) => `
        <article class="tech ${t.id === focus ? 'focus' : ''}" id="tech-${esc(t.id)}">
          <div class="tech-head"><h3>${esc(t.name)}</h3>${usage[t.id] ? `<span>${esc(usage[t.id])}</span>` : ''}</div>
          ${t.text ? `<p>${renderText(t.text, si)}</p>` : ''}
          ${t.video || t.id === focus ? `<div class="tech-actions">
            ${t.video ? `<a class="pill" href="${esc(t.video)}" target="_blank" rel="noopener">${playIcon}Se video</a>` : ''}
            ${t.id === focus ? back : ''}
          </div>` : ''}
        </article>`).join('') : '<p class="tab-lead">Denne opskrift har ingen teknikker beskrevet.</p>'}
      <div class="end-space"></div>
    </div>`;

  body.querySelector('[data-back]')?.addEventListener('click', () => { returnTo = fromRow?.id; });
  if (focus) {
    const el = body.querySelector(`#tech-${CSS.escape(focus)}`);
    requestAnimationFrame(() => el?.scrollIntoView({ block: 'center' }));
  }
  focusTech = null;
}

/* ----- Opskrift tab ----- */

function renderRecipe(body, project, techs) {
  const pat = project.pattern;
  const si = project.sizeIndex;

  if (si == null) {
    body.innerHTML = `<div class="tab-pad"><p class="tab-lead">Vælg en størrelse under Materialer, så viser opskriften dine tal.</p>
      <a class="pill brand" href="#/p/${project.id}/materialer">Gå til Materialer</a></div>`;
    return;
  }

  const sideChip = (side) => side === 'RS'
    ? `<span class="side rs">${knitIcon}Retside</span>`
    : side === 'VS' ? `<span class="side vs">${purlIcon}Vrangside</span>` : '';

  project.secOpen = project.secOpen || {};
  const secDone = (secIdx) => {
    const rows = visibleRows(project).filter((r) => r.sec === secIdx);
    return rows.length > 0 && rows.every((r) => rowStats(project, r).d === rowStats(project, r).w);
  };
  const secCollapsed = (secIdx) => (secIdx in project.secOpen ? !project.secOpen[secIdx] : secDone(secIdx));

  const marksHtml = (n) => marksFor(pat, si, n).map((m) => m.tech && techs[m.tech]
    ? `<a class="mark term" href="#tech" data-tech="${esc(m.tech)}">${esc(m.label)}</a>`
    : `<span class="mark">${esc(m.label)}</span>`).join('');

  const rowHtml = (it, rep, ri) => {
    const done = !!project.done[it.id];
    const side = it.side === 'RS' ? 'rs' : it.side === 'VS' ? 'vs' : '';
    const numbered = rep && rep.numberFrom != null;
    const marks = marksHtml(rowNumber(project, it, rep, ri));
    const label = numbered
      ? `<span class="row-num" data-ri="${ri}">${repPrefix(rep)} ${repNumber(project, rep, ri)}</span>${it.label ? `<span class="sub-label">${esc(plain(it.label, si))}</span>` : ''}`
      : `<span>${esc(plain(it.label || '', si))}</span>`;
    return `
      <div class="row ${it.type === 'measure' ? 'measure' : ''} ${side} ${done ? 'done' : ''}" data-id="${it.id}" role="checkbox" aria-checked="${done}" tabindex="0">
        <span class="check">${checkIcon}</span>
        <span class="row-body">
          ${it.label || it.side || numbered ? `<span class="row-label">${it.type === 'measure' ? rulerIcon : ''}${label}${sideChip(it.side)}<span class="marks">${marks}</span></span>` : ''}
          <span class="row-text">${renderText(it.text, si, techs)}</span>
        </span>
      </div>`;
  };

  const repeatHtml = (it) => `
    <div class="repeat" data-rep="${it.id}">
      <div class="rep-head">
        <span class="rep-title">${repeatIcon}${esc(plain(it.label || 'Gentages', si))}</span>
        <span class="rep-count"></span>
      </div>
      ${(() => {
        let ri = 0;
        return it.items.filter((r) => applies(r, si)).map((r) =>
          r.type === 'text' ? `<p class="note">${renderText(r.text, si, techs)}</p>` : rowHtml(r, it, ri++)).join('');
      })()}
      <div class="rep-foot">
        <button class="rep-undo" aria-label="Én gentagelse tilbage">−</button>
        <button class="rep-new">Ny gentagelse ↻</button>
        <span class="rep-last">Sidste gentagelse</span>
      </div>
    </div>
    ${it.until ? rowHtml(it.until) : ''}`;

  const sections = pat.sections.map((sec, secIdx) => {
    if (!applies(sec, si)) return '';
    const items = sec.items.filter((it) => applies(it, si)).map((it) => {
      if (it.type === 'text') return `<p class="note">${renderText(it.text, si, techs)}</p>`;
      if (it.type === 'repeat') return repeatHtml(it);
      return rowHtml(it);
    }).join('');
    return `
      <section class="sec ${secCollapsed(secIdx) ? 'collapsed' : ''}" data-sec="${secIdx}">
        <h2 class="sec-head"><button class="sec-toggle" aria-expanded="${!secCollapsed(secIdx)}">
          <span class="sec-title">${esc(sec.title)}</span><span class="sec-count"></span>${chevronIcon}
        </button></h2>
        <div class="sec-body">${items}</div>
      </section>`;
  }).join('');

  // Sections for the segmented progress bar
  const segSecs = pat.sections.map((s, i) => ({ s, i })).filter(({ s }) => applies(s, si));

  body.innerHTML = `
    <div class="tab-pad">
      <div class="progress-card">
        <div class="pc-top"><b id="pc-pct"></b><span id="pc-count"></span></div>
        <div class="segs">${segSecs.map(({ i }) => `<span class="seg" data-seg="${i}"><span></span></span>`).join('')}</div>
        <div class="pc-now" id="pc-now"></div>
      </div>
      ${sections}
      <div class="finish">
        ${isFinished(project)
          ? `<p class="finish-done">${knotImg}Færdig${project.finishedAt ? ` ${new Date(project.finishedAt).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}</p>
             ${project.photo ? `<img class="finish-photo" src="${project.photo}" alt="Dit færdige strik">` : ''}
             <button class="pill" id="finish-photo">${project.photo ? 'Skift billede af dit strik' : '＋ Tilføj billede af dit strik'}</button>
             <button class="primary brand finish-btn" id="again">Strik denne opskrift igen</button>
             <button class="link-btn" id="unfinish">Markér som i gang igen</button>`
          : `<button class="primary brand finish-btn" id="finish">Jeg er færdig!</button>`}
      </div>
      <div class="end-space"></div>
    </div>
    <button class="next-btn" id="next">Gå til næste pind ↓</button>`;

  const repeats = {};
  pat.sections.forEach((s) => s.items.forEach((it) => { if (it.type === 'repeat') repeats[it.id] = it; }));
  const blockRows = (rep) => rep.items.filter((r) => isRow(r) && applies(r, si));

  /** Which row may be ticked now, and which tick may be removed. */
  const tickRules = () => {
    const pr = progress(project);
    const idx = pr.next ? pr.rows.findIndex((r) => r.id === pr.next.id) : pr.rows.length;
    // A fixed-count repeat with every row ticked waits for "Ny gentagelse"
    const waiting = pr.next && pr.next.repeat && project.done[pr.next.id];
    let undoId = null;
    if (waiting) { const br = blockRows(pr.next.repeat); undoId = br[br.length - 1].id; }
    else if (idx > 0 && project.done[pr.rows[idx - 1].id]) undoId = pr.rows[idx - 1].id;
    return { pr, nextId: waiting ? null : pr.next?.id, undoId, waiting };
  };

  const updateCounts = () => {
    const pr = progress(project);
    const secStats = (secIdx) => pr.rows.filter((r) => r.sec === secIdx)
      .reduce((a, r) => { const st = rowStats(project, r); return { w: a.w + st.w, d: a.d + st.d }; }, { w: 0, d: 0 });
    body.querySelector('#pc-pct').textContent = `${pr.pct}% strikket`;
    body.querySelector('#pc-count').textContent = `${pr.done} af ${pr.total} pinde`;
    const current = pr.next?.sec;
    body.querySelectorAll('.seg').forEach((seg) => {
      const st = secStats(+seg.dataset.seg);
      seg.style.flexGrow = Math.max(st.w, 1);
      seg.firstElementChild.style.width = st.w ? `${(st.d / st.w) * 100}%` : '0';
      seg.classList.toggle('complete', st.w > 0 && st.d === st.w);
    });
    body.querySelector('#pc-now').innerHTML = pr.next
      ? `Nu: <b>${esc(pat.sections[current].title)}</b> · ${esc(displayLabel(project, pr.next) || 'næste pind')}`
      : '<b>Alle pinde er strikket</b>';
    body.querySelectorAll('.sec').forEach((secEl) => {
      const st = secStats(+secEl.dataset.sec);
      secEl.querySelector('.sec-count').textContent = st.w ? `${st.d}/${st.w}` : '';
      secEl.classList.toggle('complete', st.w > 0 && st.d === st.w);
    });
    body.querySelectorAll('.repeat').forEach((el) => {
      const rep = repeats[el.dataset.rep];
      const n = repsOf(project, rep);
      const t = repTimes(rep, si);
      const allTicked = blockRows(rep).every((r) => project.done[r.id]);
      const lastRound = t != null && n >= t - 1;
      const finished = t != null ? lastRound && allTicked : rep.until && project.done[rep.until.id];
      const total = n + (allTicked ? 1 : 0);
      el.querySelector('.rep-count').textContent = finished
        ? `Færdig · ${total} ${total === 1 ? 'gentagelse' : 'gentagelser'}`
        : t != null ? `Gentagelse ${n + 1} af ${t}` : `Gentagelse ${n + 1}`;
      el.classList.toggle('finished', !!finished);
      el.querySelector('.rep-new').hidden = lastRound;
      el.querySelector('.rep-last').hidden = !lastRound || finished;
      el.querySelector('.rep-new').classList.toggle('ready', allTicked && !finished);
      el.querySelector('.rep-undo').hidden = n === 0;
      el.querySelectorAll('.row-num').forEach((num) => {
        num.textContent = `${repPrefix(rep)} ${repNumber(project, rep, +num.dataset.ri)}`;
        const slot = num.closest('.row-label').querySelector('.marks');
        if (slot) slot.innerHTML = marksHtml(repPrefix(rep) === 'P' ? repNumber(project, rep, +num.dataset.ri) : null);
      });
    });
    body.querySelectorAll('.row.current').forEach((r) => r.classList.remove('current'));
    if (pr.next) body.querySelector(`.row[data-id="${pr.next.id}"]`)?.classList.add('current');
    const rules = tickRules();
    body.querySelectorAll('.row').forEach((r) => {
      const id = r.dataset.id;
      r.classList.toggle('locked', id !== rules.nextId && id !== rules.undoId);
    });
    body.querySelector('#next').hidden = !pr.next || isFinished(project);
    // Keep the Opskrift tile in the header in step
    const sub = app.querySelector('.tile[href$="/opskrift"] .tile-sub');
    if (sub && isStarted(project) && !isFinished(project)) sub.textContent = `${pr.done} af ${pr.total} · ${pr.pct}%`;
  };
  updateCounts();

  const toggle = async (rowEl) => {
    const rid = rowEl.dataset.id;
    const { pr, nextId, undoId, waiting } = tickRules();
    if (project.done[rid]) {
      if (rid !== undoId) {
        if (waiting && rid === pr.next.id) {
          toast('Tryk "Ny gentagelse" for at starte næste gentagelse');
          const btn = rowEl.closest('.repeat')?.querySelector('.rep-new');
          btn?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          btn?.classList.add('flash'); setTimeout(() => btn?.classList.remove('flash'), 1200);
        } else {
          toast('Du kan kun fjerne fluebenet fra den seneste pind');
        }
        return;
      }
      delete project.done[rid];
    } else {
      if (rid !== nextId) {
        if (waiting) { toast('Tryk "Ny gentagelse" først'); return; }
        if (!pr.next) return;
        toast(`Næste pind er ${displayLabel(project, pr.next)}`);
        scrollToRow(pr.next.id, true);
        return;
      }
      project.done[rid] = Date.now();
    }
    rowEl.classList.toggle('done', !!project.done[rid]);
    rowEl.setAttribute('aria-checked', !!project.done[rid]);
    if (!project.started) project.started = true;
    updateCounts();
    await store.saveProject(project);
    const after = progress(project);
    if (after.total && after.done === after.total && project.done[rid] && !isFinished(project)) toast('Alle pinde er strikket! Tryk "Jeg er færdig!" nederst.', 3500);
  };

  const newRepeat = async (el) => {
    const rep = repeats[el.dataset.rep];
    const rows = blockRows(rep);
    const t = repTimes(rep, si);
    if (t != null && repsOf(project, rep) >= t - 1) return;
    if (!rows.every((r) => project.done[r.id]) &&
        !(await ask('Ikke alle pinde i gentagelsen er krydset af.', 'Start ny gentagelse alligevel'))) return;
    project.reps = project.reps || {};
    project.reps[rep.id] = repsOf(project, rep) + 1;
    for (const r of rows) delete project.done[r.id];
    if (rep.until) delete project.done[rep.until.id];
    el.querySelectorAll('.row.done').forEach((r) => { r.classList.remove('done'); r.setAttribute('aria-checked', false); });
    body.querySelector(`.row[data-id="${rep.until?.id}"]`)?.classList.remove('done');
    updateCounts();
    await store.saveProject(project);
    toast(`Gentagelse ${project.reps[rep.id] + 1}`);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const undoRepeat = async (el) => {
    const rep = repeats[el.dataset.rep];
    if (!repsOf(project, rep)) return;
    project.reps[rep.id] -= 1;
    updateCounts();
    await store.saveProject(project);
    toast(`Tilbage til gentagelse ${project.reps[rep.id] + 1}`);
  };

  body.addEventListener('click', (e) => {
    const term = e.target.closest('.term');
    if (term) {                                        // technique → Teknikker tab
      e.preventDefault();
      const rowEl = term.closest('.row');
      focusTech = term.dataset.tech;
      fromRow = rowEl ? visibleRows(project).find((r) => r.id === rowEl.dataset.id) : null;
      recipeScroll[project.id] = window.scrollY;
      go(`#/p/${project.id}/teknikker`);
      return;
    }
    if (e.target.closest('a')) return;                 // video links open normally
    const secBtn = e.target.closest('.sec-toggle');
    if (secBtn) { const secEl = secBtn.closest('.sec'); setSecOpen(secEl, secEl.classList.contains('collapsed'), true); return; }
    if (e.target.closest('.rep-new')) return newRepeat(e.target.closest('.repeat'));
    if (e.target.closest('.rep-undo')) return undoRepeat(e.target.closest('.repeat'));
    const rowEl = e.target.closest('.row');
    if (rowEl) toggle(rowEl);
  });

  const scrollToRow = (rid, smooth) => {
    const el = rid && body.querySelector(`.row[data-id="${rid}"]`);
    if (!el) return false;
    const secEl = el.closest('.sec');
    if (secEl?.classList.contains('collapsed')) setSecOpen(secEl, true);
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1200);
    return true;
  };

  function setSecOpen(secEl, open, save) {
    secEl.classList.toggle('collapsed', !open);
    secEl.querySelector('.sec-toggle').setAttribute('aria-expanded', open);
    if (save) { project.secOpen[secEl.dataset.sec] = open; store.saveProject(project); }
  }

  body.querySelector('#next').onclick = () => scrollToRow(progress(project).next?.id, true);

  body.querySelector('#finish')?.addEventListener('click', async () => {
    const pr = progress(project);
    const left = pr.total - pr.done;
    if (left > 0 && !(await ask(`Der er ${left} ${left === 1 ? 'pind' : 'pinde'} uden flueben. Er projektet færdigt alligevel?`, 'Ja, jeg er færdig'))) return;
    const now = Date.now();
    project.finished = true;
    project.finishedAt = now;
    await store.saveProject(project);
    openSheet('Tillykke – projektet er færdigt! 🧶', [
      { label: 'Tilføj billede af dit strik', action: () => { pickPhoto(project); go('#/'); } },
    ], () => go('#/'));
  });
  body.querySelector('#finish-photo')?.addEventListener('click', () => pickPhoto(project));
  body.querySelector('#again')?.addEventListener('click', async () => {
    // New project with the same pattern; the finished one stays under "Færdige".
    const copy = await createProject(normalizePattern(JSON.parse(JSON.stringify(project.pattern))));
    toast('Nyt projekt startet');
    go(`#/p/${copy.id}`);
  });
  body.querySelector('#unfinish')?.addEventListener('click', async () => {
    project.finished = false;
    delete project.finishedAt;
    if (project.autoDone) {                        // untick the rows "Jeg er færdig!" ticked
      for (const id of project.autoDone.rows) delete project.done[id];
      project.reps = project.autoDone.reps;
      delete project.autoDone;
    }
    await store.saveProject(project);
    renderProject(project.id, 'opskrift');
  });

  // Coming back: to the row you left from, else where you were, else the next row.
  requestAnimationFrame(() => {
    const target = returnTo;
    returnTo = null;
    if (scrollToFinish) {
      scrollToFinish = false;
      body.querySelector('.finish')?.scrollIntoView({ block: 'end' });
      return;
    }
    if (target && scrollToRow(target, false)) return;
    if (recipeScroll[project.id] != null) { window.scrollTo(0, recipeScroll[project.id]); return; }
    const next = progress(project).next;
    if (next && Object.keys(project.done).length) scrollToRow(next.id, false);
  });

  // Remember the scroll position while you're in the recipe
  window.__recipeScroll = () => { recipeScroll[project.id] = window.scrollY; };
  window.addEventListener('scroll', window.__recipeScroll, { passive: true });
}

function projectMenu(project, tab) {
  const wake = store.getSetting('wakeLock', false);
  openSheet(project.pattern.title, [
    { label: photoOf(project) ? 'Skift billede' : 'Tilføj billede', action: () => pickPhoto(project) },
    {
      label: wake ? 'Hold skærmen tændt: Til' : 'Hold skærmen tændt: Fra',
      action: () => {
        store.setSetting('wakeLock', !wake);
        if (!wake) { requestWakeLock(); toast('Skærmen holdes tændt'); }
        else { releaseWakeLock(); toast('Skærmen slukker som normalt'); }
      },
    },
    {
      label: 'Nulstil fremskridt',
      action: async () => {
        if (!(await ask('Fjern alle flueben i dette projekt?', 'Nulstil fremskridt', true))) return;
        project.done = {};
        project.reps = {};
        project.finished = false;
        delete project.autoDone;
        await store.saveProject(project);
        renderProject(project.id, tab);
      },
    },
    {
      label: 'Slet projekt', cls: 'danger',
      action: async () => {
        if (!(await ask(`Slet "${project.pattern.title}"? Det kan ikke fortrydes.`, 'Slet projekt', true))) return;
        await store.deleteProject(project.id);
        go('#/');
      },
    },
  ]);
}

/* ---------- keep screen on while knitting ---------- */

let wakeLock = null;
async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
}
function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && location.hash.startsWith('#/p/') && store.getSetting('wakeLock', false)) {
    requestWakeLock();
  }
});

/* ---------- routing ---------- */

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function route() {
  if (window.__recipeScroll) window.removeEventListener('scroll', window.__recipeScroll);
  window.__recipeScroll = null;
  const m = location.hash.match(/^#\/p\/([^/]+)(?:\/(\w+))?$/);
  window.scrollTo(0, 0);
  if (m) renderProject(m[1], m[2]);
  else renderHome();
}
window.addEventListener('hashchange', route);

/* ---------- icons ---------- */

const knotImg = '<img class="finish-knot" src="icons/knot.png" alt="">';
const chevronIcon = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const playIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10l8-5z" fill="currentColor"/></svg>';
const dotsIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
const backIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const checkIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 12.5l4 4 8-9"/></svg>';
const rulerIcon = '<svg class="ruler" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="2.5" y="8" width="19" height="8" rx="1.5"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/></svg>';
const repeatIcon = '<svg class="rep-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11a7 7 0 0 1 12-4.9L19 9"/><path d="M19 4v5h-5"/><path d="M20 13a7 7 0 0 1-12 4.9L5 15"/><path d="M5 20v-5h5"/></svg>';
const knitIcon = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M2 3l4 6 4-6"/></svg>';
const purlIcon = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M2 6h8"/></svg>';
const yarnIcon = '<svg class="tile-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="13" r="7"/><path d="M5 11c4 1 8 0 11-4M6 16c4 1 9-1 11-5"/><path d="M16 4l5-1"/></svg>';
const bookIcon = '<svg class="tile-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z"/><path d="M20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"/></svg>';
const listIcon = '<svg class="tile-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7l2 2 3-3M4 15l2 2 3-3M12 8h8M12 16h8"/></svg>';

/* ---------- start ---------- */

route();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
