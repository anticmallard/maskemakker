// app.js — Maskemakker: screens and interaction. All saving goes through storage.js.
import * as store from './storage.js';
import * as GU from './garn-ui.js';

const app = document.getElementById('app');
const fileInput = document.getElementById('file-input');
const photoInput = document.getElementById('photo-input');
const sheet = document.getElementById('sheet');

const TABS = ['materialer', 'teknikker', 'opskrift'];
const APP_VERSION = '28. oktober 2026';
const CONTACT_EMAIL = 'contact@maskemakker.com';   // MM-20: replace with the real address

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
  // A finished project counts as 100 %, even if some rows were never ticked.
  if (project.finished) done = total;
  return { rows, done, total, pct: total ? Math.round((done / total) * 100) : project.finished ? 100 : 0, next };
}

const isStarted = (p) => !!p.started;
/** A project is finished when you tap "Jeg er færdig!" at the bottom of the recipe. */
const isFinished = (p) => !!p.finished;
const isFinishedFlag = isFinished;
/** The pattern's own photos (MM-12). Older pattern files only have one cropped `photo`. */
const patternPhotos = (pat) => (pat.photos && pat.photos.length ? pat.photos : pat.photo ? [pat.photo] : []);

/** Your own photos of the project (older projects had a single `photo`). */
const photosOf = (p) => p.photos || (p.photo ? [p.photo] : []);
const photoOf = (p) => photosOf(p)[0] || p.pattern.photo || null;

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

/**
 * Pick a pattern file. `then` says what happens after it's saved in the library:
 * 'start' starts a project straight away, 'library' stays on Opskrifter.
 */
let importThen = 'start';
function pickFile(then = 'start') { importThen = then; fileInput.value = ''; fileInput.click(); }

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.kind === 'strik-backup') {
      for (const p of data.projects || []) await store.saveProject(p);
      for (const r of data.recipes || []) await store.saveRecipe(r);
      toast(`${(data.projects || []).length} projekt(er) gendannet`);
      route();
      return;
    }
    const { recipe, isNew } = await addRecipe(normalizePattern(data));
    if (importThen === 'start') { await startFromRecipe(recipe); return; }
    toast(isNew ? 'Opskriften er gemt i Opskrifter' : 'Opskriften er opdateret');
    route();
  } catch (err) {
    toast('Kunne ikke importere filen: ' + err.message, 4500);
  }
});

const clone = (x) => JSON.parse(JSON.stringify(x));
const sameRecipe = (a, b) => a.title === b.title && (a.designer || '') === (b.designer || '');

/** Saves a pattern in the library. Importing the same pattern again updates it instead of adding a copy. */
async function addRecipe(pattern) {
  const existing = (await store.listRecipes()).find((r) => sameRecipe(r.pattern, pattern));
  if (existing) {
    existing.pattern = clone(pattern);
    await store.saveRecipe(existing);
    // Display-only fields are safe to copy into projects knitted from it (rows and ticks are untouched).
    const SAFE = ['photo', 'photos', 'measurements', 'sizeGuide', 'tips', 'intro'];
    for (const p of await store.listProjects()) {
      if (p.recipeId !== existing.id) continue;
      for (const k of SAFE) { if (pattern[k] != null) p.pattern[k] = clone(pattern[k]); else delete p.pattern[k]; }
      await store.saveProject(p);
    }
    return { recipe: existing, isNew: false };
  }
  const recipe = await store.saveRecipe({ id: uid(), pattern: clone(pattern), added: Date.now() });
  return { recipe, isNew: true };
}

/** New project from a recipe in the library, then straight to Materialer to choose a size. */
async function startFromRecipe(recipe) {
  const project = await createProject(normalizePattern(clone(recipe.pattern)), recipe.id);
  recipe.used = Date.now();
  await store.saveRecipe(recipe);
  go(`#/p/${project.id}`);
}

/**
 * Keeps the library in step: projects from before the library existed get their recipe added,
 * and the example recipe is added once (it can be deleted like any other).
 */
async function syncLibrary(projects) {
  const recipes = await store.listRecipes();
  for (const p of projects) {
    if (p.recipeId) continue;
    let r = recipes.find((x) => sameRecipe(x.pattern, p.pattern));
    if (!r) { r = await store.saveRecipe({ id: uid(), pattern: clone(p.pattern), added: p.created || Date.now() }); recipes.push(r); }
    p.recipeId = r.id;
    await store.saveProject(p);
  }
  if (!store.getSetting('exampleAdded', false)) {
    try {
      const res = await fetch('patterns/eksempel.json', { cache: 'no-store' });
      await addRecipe(normalizePattern(await res.json()));
      store.setSetting('exampleAdded', true);
    } catch { /* offline: try again next time */ }
  }
}

async function createProject(pattern, recipeId = null) {
  return store.saveProject({
    id: uid(),
    recipeId,
    pattern,
    sizeIndex: pattern.sizes.length === 1 ? 0 : null,
    done: {},
    have: {},
    reps: {},
    secOpen: allSecs(pattern, false),   // MM-13: new projects start with every section folded
    started: false,
    created: Date.now(),
  });
}

function allSecs(pattern, open) {
  return Object.fromEntries((pattern.sections || []).map((_, i) => [i, open]));
}

async function loadExample() {
  try {
    const res = await fetch('patterns/eksempel.json', { cache: 'no-store' });
    await addRecipe(normalizePattern(await res.json()));
    toast('Eksempelopskriften er lagt i Opskrifter');
    go('#/opskrifter');
  } catch {
    toast('Kunne ikke hente eksemplet.');
  }
}

let photoTarget = null;
function pickPhoto(project) { photoTarget = project; photoInput.value = ''; photoInput.click(); }

photoInput.addEventListener('change', async () => {
  const files = [...photoInput.files];
  if (!files.length || !photoTarget) return;
  const p = photoTarget;
  const before = photosOf(p);
  try {
    const added = [];
    for (const f of files) added.push(await shrinkImage(f, 900));
    p.photos = [...before, ...added];
    delete p.photo;
    await store.saveProject(p);
    toast(added.length === 1 ? 'Billede gemt' : `${added.length} billeder gemt`);
  } catch (e) {
    p.photos = before;
    toast(e && e.name === 'QuotaExceededError'
      ? 'Der er ikke plads til flere billeder på telefonen.' : 'Kunne ikke læse billedet.', 3500);
  }
  const y = window.scrollY;
  await route();
  window.scrollTo(0, y);
});

/** Shrinks a photo (max side in px) so it fits comfortably in storage. */
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
      resolve(c.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function exportBackup() {
  const projects = await store.listProjects();
  const recipes = await store.listRecipes();
  const json = JSON.stringify({ kind: 'strik-backup', exported: new Date().toISOString(), projects, recipes }, null, 2);
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

async function renderHome(view = 'projekter') {
  releaseWakeLock();
  const projects = await store.listProjects();
  await syncLibrary(projects);
  const recipes = await store.listRecipes();
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
          ${photo ? `<img src="${photo}" alt="">` : `<img class="knot-faded" src="icons/knot.png" alt="">`}
          ${isFinished(p) ? '<span class="pct-badge">Færdig</span>' : isStarted(p) ? `<span class="pct-badge">${pr.pct}%</span>` : '<span class="new-badge">Ny</span>'}
        </div>
        <div class="card-body">
          <div class="card-title">${esc(p.pattern.title)}</div>
          <div class="card-meta">${meta}</div>
          <div class="bar"><div style="width:${pr.pct}%"></div></div>
        </div>
      </a>`;
  };
  const startCard = `
    <button class="card start-card" id="start-new">
      <div class="card-pic"><span class="start-plus">${plusIcon}</span></div>
      <div class="card-body">
        <div class="card-title">Start nyt projekt</div>
        <div class="card-meta">Vælg opskrift eller importér</div>
      </div>
    </button>`;

  const projectsView = `
    <div class="group-label">I gang · ${active.length}</div>
    <div class="cards">${active.map(card).join('')}${startCard}</div>
    <div class="group-label">Færdige · ${finished.length}</div>
    ${finished.length ? `<div class="cards">${finished.map(card).join('')}</div>` : '<div class="placeholder">Færdige projekter samles her</div>'}`;

  const recipesView = `
    <button class="import-row" id="import-lib">${fileIcon}<span><b>Importér ny opskrift</b><span>Den bliver gemt her til næste gang</span></span></button>
    <div class="group-label">Dine opskrifter · ${recipes.length}</div>
    ${recipes.length ? `<div class="recipe-list">${recipes.map((r) => `
      <div class="recipe-row">
        <button class="recipe-main" data-start="${r.id}" aria-label="Start nyt projekt med ${esc(r.pattern.title)}">${recipeLine(r, projects)}</button>
        <button class="icon-btn recipe-more" data-more="${r.id}" aria-label="Mere for ${esc(r.pattern.title)}">${dotsIcon}</button>
      </div>`).join('')}</div>`
      : '<div class="placeholder">Opskrifter, du importerer, samles her</div>'}`;

  app.innerHTML = `
    ${homeHeader()}
    <main class="home">${view === 'opskrifter' ? recipesView : projectsView}
    </main>
    ${tabbar(view)}`;

  app.querySelector('#start-new')?.addEventListener('click', () => openStartSheet(recipes, projects));
  app.querySelector('#import-lib')?.addEventListener('click', () => pickFile('library'));
  app.querySelectorAll('[data-start]').forEach((b) => b.onclick = () => startFromRecipe(recipes.find((r) => r.id === b.dataset.start)));
  app.querySelectorAll('[data-more]').forEach((b) => b.onclick = () => recipeMenu(recipes.find((r) => r.id === b.dataset.more)));
  wireHomeHeader();
}

/** The green header on the three front-page tabs, with the logo and the ••• menu. */
const homeHeader = () => `
    <header class="brandbar home-bar">
      <h1 class="wordmark"><img src="icons/wordmark.png" alt="Maskemakker"></h1>
      <button class="icon-btn on-brand" id="home-menu" aria-label="Menu">${dotsIcon}</button>
    </header>`;
function wireHomeHeader() {
  app.querySelector('#home-menu').onclick = () => openSheet('Maskemakker', [
    { label: 'Gem backup af alle projekter', action: exportBackup },
    { label: 'Tilføj eksempelopskrift', action: loadExample },
    { label: 'Om Maskemakker', action: () => go('#/om') },
  ]);
}

/** Bottom menu: Projekter, Opskrifter, Garn. */
function tabbar(view) {
  const t = (href, key, icon, label) => `<a href="${href}" ${view === key ? 'aria-current="page"' : ''}><span class="tb-ic">${icon}</span>${label}</a>`;
  return `<nav class="tabbar" aria-label="Forside">
      ${t('#/', 'projekter', needleIcon, 'Projekter')}${t('#/opskrifter', 'opskrifter', bookOutline, 'Opskrifter')}${t('#/garn', 'garn', yarnIcon.replace('class="tile-ic" ', ''), 'Garn')}
    </nav>`;
}

/* ---------- about (MM-19) ---------- */

function renderAbout() {
  releaseWakeLock();
  const year = new Date().getFullYear();
  app.innerHTML = `
    <header class="brandbar project">
      <div class="proj-bar">
        <a class="icon-btn on-brand" href="#/" aria-label="Tilbage">${backIcon}</a>
        <div class="proj-title">Om Maskemakker</div>
      </div>
    </header>
    <main class="about">
      <img class="about-knot" src="icons/knot.png" alt="">
      <p class="about-lead">Maskemakker holder styr på dine strikkeprojekter: hvilken pind du er nået til, tallene i den størrelse du strikker, og de projekter, du har gjort færdige.</p>

      <section class="about-sec">
        <h2>Ophavsret</h2>
        <p>© ${year} Maskemakker. Alle rettigheder forbeholdes.</p>
        <p>Strikkeopskrifter tilhører deres designere og er beskyttet af ophavsret. Opskrifter, du importerer, er kun til dit eget, private brug og må ikke deles eller sælges videre. Maskemakker indeholder og deler ingen opskrifter.</p>
      </section>

      <section class="about-sec">
        <h2>Dine data</h2>
        <p>Dine projekter, opskrifter og billeder gemmes kun på denne telefon. Tag en backup fra menuen (•••) på forsiden en gang imellem.</p>
      </section>

      <section class="about-sec">
        <h2>Kontakt</h2>
        <p>Har du spørgsmål, idéer eller har du fundet en fejl? Skriv gerne.</p>
        <a class="primary brand about-mail" href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Maskemakker')}">${mailIcon}${CONTACT_EMAIL}</a>
      </section>

      <p class="about-version">Version ${APP_VERSION}</p>
    </main>`;
}

/** Status of a recipe from the projects knitted from it. */
function recipeStatus(r, projects) {
  const mine = projects.filter((p) => p.recipeId === r.id);
  if (mine.some((p) => !isFinished(p))) return { text: 'I gang nu', cls: 'now' };
  const n = mine.filter(isFinished).length;
  return n ? { text: `Strikket ${n} ${n === 1 ? 'gang' : 'gange'}`, cls: '' } : { text: 'Ikke strikket endnu', cls: '' };
}

/** The pattern photo, else your own photo of a project knitted from it. */
function recipePhoto(r, projects) {
  if (r.pattern.photo) return r.pattern.photo;
  for (const p of projects) if (p.recipeId === r.id && photosOf(p).length) return photosOf(p)[0];
  return null;
}

function recipeLine(r, projects) {
  const pat = r.pattern;
  const photo = recipePhoto(r, projects);
  const st = recipeStatus(r, projects);
  const designer = (pat.designer || '').split('·')[0].trim();
  const sizes = pat.sizes.length === 1 ? 'Én størrelse' : `${pat.sizes.length} størrelser`;
  return `
    ${photo ? `<img class="rec-pic" src="${photo}" alt="">` : `<span class="rec-pic rec-empty"><img src="icons/knot.png" alt=""></span>`}
    <span class="rec-text">
      <span class="rec-title">${esc(pat.title)}</span>
      <span class="rec-meta">${esc([designer, sizes].filter(Boolean).join(' · '))}</span>
      <span class="rec-status ${st.cls}">${esc(st.text)}</span>
    </span>`;
}

/** P34: the sheet from the "Start nyt projekt" card. */
function openStartSheet(recipes, projects) {
  openSheet('Start nyt projekt', [
    { cls: 'import-row in-sheet', html: `${fileIcon}<span><b>Importér ny opskrift</b><span>Vælg en opskriftsfil på telefonen</span></span>`, action: () => pickFile('start') },
    ...recipes.map((r) => ({ cls: 'sheet-rec', html: recipeLine(r, projects) + chevronRight, action: () => startFromRecipe(r) })),
  ]);
  if (recipes.length) sheet.querySelector('.import-row')?.insertAdjacentHTML('afterend', '<div class="sheet-sub">Eller vælg en af dine opskrifter</div>');
  sheet.querySelector('.sheet-title')?.classList.add('big');
}

function recipeMenu(r) {
  openSheet(r.pattern.title, [
    { label: 'Start nyt projekt', action: () => startFromRecipe(r) },
    {
      label: 'Slet opskrift', cls: 'danger',
      action: async () => {
        if (!(await ask(`Slet "${r.pattern.title}" fra Opskrifter? Projekter, du har strikket efter den, bliver ikke slettet.`, 'Slet opskrift', true))) return;
        await store.deleteRecipe(r.id);
        toast('Opskriften er slettet');
        route();
      },
    },
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
  const nTech = (pat.techniques || []).length;

  const tile = (key, label, icon, sub) => `
    <a class="tile ${tab === key ? 'on' : ''}" href="#/p/${id}/${key}" ${tab === key ? 'aria-current="page"' : ''}>
      ${icon}<span class="tile-label">${label}</span><span class="tile-sub">${sub}</span>
    </a>`;

  app.innerHTML = `
    <header class="brandbar project">
      <div class="proj-bar">
        <a class="icon-btn on-brand" href="#/" aria-label="Tilbage">${backIcon}</a>
        ${photoOf(project) ? `<img class="proj-thumb" src="${photoOf(project)}" alt="">` : ''}
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
  if (tab === 'materialer') renderMaterials(body, project, isFinished(project) ? null : await previousProject(project));
  if (tab === 'teknikker') renderTechniques(body, project);
  if (tab === 'opskrift') renderRecipe(body, project, techs);

  app.querySelector('#proj-menu').onclick = () => projectMenu(project, tab);

  if (store.getSetting('wakeLock', false)) requestWakeLock();
}

/* ----- Materialer tab ----- */

/**
 * MM-16: the most recently finished project from the same recipe (not this one), so a new
 * project can show what you noted last time.
 */
async function previousProject(project) {
  const same = (p) => (project.recipeId && p.recipeId ? p.recipeId === project.recipeId : sameRecipe(p.pattern, project.pattern));
  return (await store.listProjects())
    .filter((p) => p.id !== project.id && isFinished(p) && same(p))
    .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))[0] || null;
}

const FIT_PHRASE = ['blev meget lille', 'blev lidt lille', 'passede som forventet', 'blev lidt stor', 'blev meget stor'];

/** The "Fra sidste gang" box at the top of Materialer. */
function lastTimeHtml(prev) {
  const pat = prev.pattern;
  const size = prev.sizeIndex != null && pat.sizes.length > 1 ? pat.sizes[prev.sizeIndex] : null;
  const fit = prev.fit != null ? FIT_PHRASE[prev.fit] : null;
  const dot = (t) => (t.endsWith('.') ? t : `${t}.`);   // "3-6 mdr." already ends with a full stop
  const yarn = yarnsUsed(prev).map((y) => y.name).join(' + ');
  const needles = needleSizesOf(prev).join(' og ');
  // "Du strikkede størrelse 1-2 år med Sunday fra Sandnes Garn på 3 mm pinde. Den blev meget stor."
  const parts = [size && `størrelse ${size}`, yarn && `med ${yarn}`, needles && `på ${needles} pinde`].filter(Boolean);
  const line = [parts.length && dot(`Du strikkede ${parts.join(' ')}`), fit && `Den ${fit}.`].filter(Boolean).join(' ');
  const photo = photosOf(prev)[0];
  const when = prev.finishedAt ? daDate(prev.finishedAt, { month: 'short', year: 'numeric' }) : '';
  return `
    <section class="last-time" aria-label="Fra sidste gang">
      ${photo ? `<img src="${photo}" alt="Dit strik fra sidste gang">` : ''}
      <div class="last-text">
        <h3>Fra sidste gang${when ? ` · ${esc(when)}` : ''}</h3>
        ${line ? `<p class="last-fit">${esc(line)}</p>` : ''}
        ${prev.notes ? `<p class="last-notes">"${esc(prev.notes.trim())}"</p>` : ''}
      </div>
    </section>`;
}

function renderMaterials(body, project, prev = null) {
  const pat = project.pattern;
  const si = project.sizeIndex;
  const details = pat.sizeDetails || [];
  const started = isStarted(project);
  const lastSize = prev ? prev.sizeIndex : null;
  const lastTag = 'Brugt sidst';   // same wording as under Garn; the fit is in the box above

  const sizeBtns = pat.sizes.map((s, i) => `
    <button class="size-btn ${i === si ? 'on' : ''}" data-size="${i}">
      <b>${esc(s)}</b>${details[i] ? `<span>${esc(details[i])}</span>` : ''}${i === lastSize ? `<span class="last-tag">${esc(lastTag)}</span>` : ''}
    </button>`).join('');

  // Older pattern files: one plain list
  const materials = !pat.yarn && !pat.needles ? (pat.materials || []).map((m) => `
    <div class="list-row">${renderText(m.text, si)}</div>`).join('') : '';

  // MM-14: "Dit garn" – the yarn you actually use, if it differs from the pattern's
  project.myYarns = project.myYarns || [];
  const field = (i, key, label, attrs = '') => `
    <label class="my-field"><span>${label}</span><input data-my="${i}" data-key="${key}" value="${esc(project.myYarns[i][key] || '')}" autocomplete="off" ${attrs}></label>`;
  const myYarnHtml = `
    ${project.myYarns.map((y, i) => {
      const more = ['material', 'metersPer50'].some((k) => (y[k] || '').toString().trim());
      return `
      <div class="my-yarn panel">
        <div class="my-yarn-head"><b>${project.myYarns.length > 1 ? `Dit garn ${i + 1}` : 'Dit garn'}</b>
          <button class="link-btn" data-my-del="${i}">Fjern</button></div>
        <div class="my-grid">
          ${field(i, 'brand', 'Mærke', 'placeholder="Fx Sandnes Garn"')}
          ${field(i, 'name', 'Garn', 'placeholder="Fx Double Sunday"')}
        </div>
        ${field(i, 'color', 'Farve', 'placeholder="Navn eller nummer"')}
        <details class="my-more" ${more ? 'open' : ''}>
          <summary>Flere detaljer</summary>
          <div class="my-grid">
            ${field(i, 'material', 'Materiale', 'placeholder="Fx 100 % merino"')}
            ${field(i, 'metersPer50', 'Løbelængde (m pr. 50 g)', 'inputmode="decimal" placeholder="Fx 108"')}
          </div>
        </details>
      </div>`;
    }).join('')}
    <button class="pill my-add" id="my-add">${plusIcon}${project.myYarns.length ? 'Tilføj et garn mere' : 'Jeg bruger et andet garn'}</button>
    ${project.myYarns.length ? '<p class="hint">Opskriften ændrer sig ikke. Dit garn vises på projektkortet, når du er færdig.</p>' : ''}`;

  // Yarn: when the pattern suggests several, you pick the one you use
  const yarnOpts = pat.yarn || [];
  const yarnHtml = yarnOpts.length > 1 ? `
    <p class="hint top">Opskriften foreslår ${yarnOpts.length} garner. Vælg det, du bruger.</p>
    <div class="choice-list" role="radiogroup">
      ${yarnOpts.map((y, i) => `
        <button class="choice ${project.yarnChoice === i ? 'on' : ''}" data-yarn="${i}" role="radio" aria-checked="${project.yarnChoice === i}">
          <span class="radio"></span>
          <span class="choice-body"><b>${esc(y.name)}</b>${y.text ? `<span>${renderText(y.text, si)}</span>` : ''}${prev && prev.yarnChoice === i ? '<span class="last-tag">Brugt sidst</span>' : ''}</span>
        </button>`).join('')}
    </div>` : yarnOpts.length === 1 ? `
    <div class="panel"><div class="list-row"><b>${esc(yarnOpts[0].name)}</b>${yarnOpts[0].text ? `<br>${renderText(yarnOpts[0].text, si)}` : ''}</div></div>` : '';

  // With your own yarn, "Dit garn" comes first and the pattern's yarns are only shown as information,
  // with the one you replaced marked, so the pattern's yarn no longer looks chosen.
  const hasOwn = ownYarns(project).length > 0;
  const replacedIdx = yarnOpts.length > 1 ? project.yarnChoice ?? null : 0;
  const patternYarnInfo = yarnOpts.length ? `
    <p class="hint top">${yarnOpts.length > 1 ? 'Opskriften foreslår:' : 'Opskriftens garn:'}</p>
    <div class="panel pat-yarns">${yarnOpts.map((y, i) => `
      <div class="list-row"><span class="pat-yarn-name"><b>${esc(y.name)}</b>${i === replacedIdx ? '<span class="replaced-tag">Erstattet</span>' : ''}</span>${y.text ? `<span class="pat-yarn-text">${renderText(y.text, si)}</span>` : ''}</div>`).join('')}
    </div>` : '';
  const findPill = yarnOpts.length ? `<button class="pill my-find" id="find-alt">${searchIcon}${hasOwn ? 'Find et andet alternativ' : `Find et alternativ til ${esc(patternYarns(project)[0].name.split(/\s+fra\s+/i)[0])}`}</button>` : '';

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

  // Finished measurements and size advice belong with Størrelse
  const meas = pat.measurements || [];
  const sizeInfo = meas.length || pat.sizeGuide ? `
    <div class="panel size-info">
      ${meas.length ? `<div class="size-info-head">Færdige mål${si != null ? ` · ${esc(pat.sizes[si])}` : ''}</div>
        ${si == null ? '<p class="size-info-wait">Vælg en størrelse for at se målene.</p>'
          : `<div class="gauge">${meas.map((m) => `<div class="gauge-cell"><span>${esc(m.label)}</span><b>${renderText(m.text, si)}</b></div>`).join('')}</div>`}` : ''}
      ${pat.sizeGuide ? `<p class="size-guide">${renderText(pat.sizeGuide, si)}</p>` : ''}
    </div>` : '';

  const gal = patternPhotos(pat);
  const galleryHtml = gal.length ? `
    <div class="gallery" role="region" aria-roledescription="karrusel" aria-label="Billeder af ${esc(pat.title)}">
      <div class="gal-strip" id="gal-strip">${gal.map((src, i) => `<img src="${src}" alt="${esc(pat.title)}, billede ${i + 1} af ${gal.length}">`).join('')}</div>
      ${gal.length > 1 ? `
        <button class="gal-btn prev" id="gal-prev" aria-label="Forrige billede" hidden>${backIcon}</button>
        <button class="gal-btn next" id="gal-next" aria-label="Næste billede">${backIcon}</button>
        <span class="gal-count" id="gal-count" aria-live="polite">1 / ${gal.length}</span>` : ''}
    </div>` : '';

  body.innerHTML = `
    <div class="tab-pad">
      ${galleryHtml}
      ${!started ? `
        <h2 class="tab-title">Klar til at slå op?</h2>
        <p class="tab-lead">Vælg størrelse først. Så viser opskriften og garnmængden kun dine tal.</p>` : ''}
      ${prev ? lastTimeHtml(prev) : ''}
      ${pat.sizes.length > 1 ? `
        <h3 class="block-title">Størrelse</h3>
        <div class="size-grid">${sizeBtns}</div>
        ${hint ? `<p class="hint">${hint}</p>` : ''}
        ${sizeInfo}` : ''}
      ${materials ? `<h3 class="block-title">Garn og pinde</h3><div class="panel">${materials}</div>` : ''}
      <h3 class="block-title">Garn</h3>
      ${hasOwn ? `<div class="my-yarns">${myYarnHtml}</div>${patternYarnInfo}${findPill}` : `${yarnHtml}${findPill}<div class="my-yarns">${myYarnHtml}</div>`}
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

  // Gallery: swipe, or tap the arrows
  const strip = body.querySelector('#gal-strip');
  if (strip && gal.length > 1) {
    const idx = () => Math.round(strip.scrollLeft / strip.clientWidth);
    const sync = () => {
      const i = idx();
      body.querySelector('#gal-prev').hidden = i === 0;
      body.querySelector('#gal-next').hidden = i === gal.length - 1;
      body.querySelector('#gal-count').textContent = `${i + 1} / ${gal.length}`;
    };
    const goTo = (i) => strip.scrollTo({ left: i * strip.clientWidth, behavior: 'smooth' });
    body.querySelector('#gal-prev').onclick = () => goTo(idx() - 1);
    body.querySelector('#gal-next').onclick = () => goTo(idx() + 1);
    strip.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true });
  }

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
  // "Dit garn": typing saves quietly; adding or removing redraws
  let myT = 0;
  body.querySelectorAll('[data-my]').forEach((inp) => inp.addEventListener('input', () => {
    project.myYarns[+inp.dataset.my][inp.dataset.key] = inp.value;
    clearTimeout(myT); myT = setTimeout(() => store.saveProject(project), 400);
  }));
  const redrawMaterials = async (focusIdx) => {
    const y = window.scrollY;
    await store.saveProject(project);
    await renderProject(project.id, 'materialer');
    window.scrollTo(0, y);
    if (focusIdx != null) app.querySelector(`[data-my="${focusIdx}"][data-key="brand"]`)?.focus();
  };
  // Scenario B: the Garnvælger with this pattern's yarn and size filled in
  body.querySelector('#find-alt')?.addEventListener('click', () => go(`#/garn/til/${project.id}`));
  body.querySelector('#my-add')?.addEventListener('click', () => {
    project.myYarns.push({});
    redrawMaterials(project.myYarns.length - 1);
  });
  body.querySelectorAll('[data-my-del]').forEach((b) => b.onclick = async () => {
    const i = +b.dataset.myDel;
    const y = project.myYarns[i];
    if (Object.values(y).some((v) => String(v).trim()) && !(await ask('Fjern dette garn?', 'Fjern garn', true))) return;
    project.myYarns.splice(i, 1);
    redrawMaterials();
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
    project.startedAt = project.startedAt || Date.now();
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
          ? `${doneCard(project)}
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
      .reduce((a, r) => { const st = rowStats(project, r); return { w: a.w + st.w, d: a.d + (isFinished(project) ? st.w : st.d) }; }, { w: 0, d: 0 });
    body.querySelector('#pc-pct').textContent = `${pr.pct}% strikket`;
    body.querySelector('#pc-count').textContent = `${pr.done} af ${pr.total} pinde`;
    const current = pr.next?.sec;
    body.querySelectorAll('.seg').forEach((seg) => {
      const st = secStats(+seg.dataset.seg);
      seg.style.flexGrow = Math.max(st.w, 1);
      seg.firstElementChild.style.width = st.w ? `${(st.d / st.w) * 100}%` : '0';
      seg.classList.toggle('complete', st.w > 0 && st.d === st.w);
    });
    body.querySelector('#pc-now').innerHTML = isFinished(project) ? '<b>Projektet er færdigt</b>' : pr.next
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
    updateNextBtn();
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
    if (!project.startedAt) project.startedAt = Date.now();
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
    if (secEl?.classList.contains('collapsed')) setSecOpen(secEl, true, true);
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1200);
    return true;
  };

  function setSecOpen(secEl, open, save) {
    secEl.classList.toggle('collapsed', !open);
    secEl.querySelector('.sec-toggle').setAttribute('aria-expanded', open);
    if (save) { project.secOpen[secEl.dataset.sec] = open; store.saveProject(project); }
    updateNextBtn();
  }

  // MM-8: the "next row" button hides while the next row is on screen,
  // and points up when you have scrolled past it.
  function updateNextBtn() {
    const btn = body.querySelector('#next');
    if (!btn || btn.hidden) return;
    const pr = progress(project);
    const rowEl = pr.next && body.querySelector(`.row[data-id="${pr.next.id}"]`);
    if (!rowEl) return;
    const secEl = rowEl.closest('.sec');
    const folded = secEl?.classList.contains('collapsed');
    const r = (folded ? secEl : rowEl).getBoundingClientRect();
    const above = r.bottom < 0;
    const below = r.top > window.innerHeight - 80;   // room for the button itself
    btn.classList.toggle('away', !folded && !above && !below);
    btn.textContent = above ? 'Gå til næste pind ↑' : below ? 'Gå til næste pind ↓' : 'Gå til næste pind';
  }

  body.querySelector('#next').onclick = () => scrollToRow(progress(project).next?.id, true);

  body.querySelector('#finish')?.addEventListener('click', async () => {
    const pr = progress(project);
    const left = pr.total - pr.done;
    if (left > 0 && !(await ask(`Der er ${left} ${left === 1 ? 'pind' : 'pinde'} uden flueben. De bliver krydset af, når du markerer projektet som færdigt.`, 'Ja, jeg er færdig'))) return;
    const now = Date.now();
    // Remember the ticks as they are now, so "Markér som i gang igen" can put them back.
    project.autoDone = { done: { ...project.done }, reps: { ...(project.reps || {}) } };
    tickAll(project, now);
    project.finished = true;
    project.finishedAt = now;
    project.secOpen = allSecs(project.pattern, false);   // MM-10: fold the whole recipe
    await store.saveProject(project);
    scrollToFinish = true;                               // land on the new project card
    renderProject(project.id, 'opskrift');
  });
  if (isFinished(project)) wireDoneCard(body, project);
  body.querySelector('#again')?.addEventListener('click', async () => {
    // New project with the same pattern; the finished one stays under "Færdige".
    const copy = await createProject(normalizePattern(JSON.parse(JSON.stringify(project.pattern))), project.recipeId || null);
    toast('Nyt projekt startet');
    go(`#/p/${copy.id}`);
  });
  body.querySelector('#unfinish')?.addEventListener('click', async () => {
    project.finished = false;
    delete project.finishedAt;
    if (project.autoDone) {                        // put the ticks back as they were before "Jeg er færdig!"
      if (project.autoDone.done) project.done = project.autoDone.done;
      else for (const id of project.autoDone.rows || []) delete project.done[id];   // older format
      project.reps = project.autoDone.reps || {};
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
      const card = body.querySelector('.done-card');
      if (card) window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - 12);
      return;
    }
    if (target && scrollToRow(target, false)) return;
    if (recipeScroll[project.id] != null) { window.scrollTo(0, recipeScroll[project.id]); return; }
    const next = progress(project).next;
    if (next && Object.keys(project.done).length) scrollToRow(next.id, false);
  });

  // Remember the scroll position while you're in the recipe
  let nextTick = 0;
  window.__recipeScroll = () => {
    recipeScroll[project.id] = window.scrollY;
    if (!nextTick) nextTick = requestAnimationFrame(() => { nextTick = 0; updateNextBtn(); });
  };
  window.addEventListener('scroll', window.__recipeScroll, { passive: true });
}

/* ----- Project card: shown at the bottom of the recipe when a project is finished ----- */

const DAY = 86400000;
const FIT = ['Meget lille', 'Lidt lille', 'Som forventet', 'Lidt stor', 'Meget stor'];
const daDate = (t, opts) => new Date(t).toLocaleDateString('da-DK', opts);

/** When knitting started: saved on "Start strikning" / first tick; older projects use the first tick. */
function startOf(p) {
  if (p.startedAt) return p.startedAt;
  const ticks = Object.values(p.done || {}).filter((v) => typeof v === 'number');
  return ticks.length ? Math.min(...ticks) : p.created;
}

/** Rows actually knitted, counting every repeat. */
function rowsKnitted(p) {
  let n = 0;
  for (const r of visibleRows(p)) {
    if (r.repeat && !repTimes(r.repeat, p.sizeIndex)) n += (p.done[r.id] ? 1 : 0) + repsOf(p, r.repeat);
    else n += rowStats(p, r).d;
  }
  return n;
}

/** MM-14: yarn you registered yourself under Materialer ("Dit garn"). */
const ownYarns = (p) => (p.myYarns || []).filter((y) => (y.name || '').trim() || (y.brand || '').trim());
/** "Double Sunday fra Sandnes Garn i farven Lysegrøn" */
function yarnLabel(y) {
  const name = (y.name || '').trim(), brand = (y.brand || '').trim(), color = (y.color || '').trim();
  const base = name && brand ? `${name} fra ${brand}` : name || brand;
  return color ? `${base} i farven ${color}` : base;
}

/** The yarn(s) you knit with: your own yarn if you registered one, else the pattern's (your choice when it suggests several). */
function yarnsUsed(p) {
  const own = ownYarns(p);
  if (own.length) return own.map((y) => ({ name: yarnLabel(y), own: y }));
  return patternYarns(p);
}

/** The pattern's yarn: your choice when it suggests several. */
function patternYarns(p) {
  const ys = p.pattern.yarn || [];
  if (ys.length > 1 && p.yarnChoice != null && ys[p.yarnChoice]) return [ys[p.yarnChoice]];
  return ys.slice(0, 1);
}

/**
 * Yarn used for the chosen size, from the pattern's yarn text, e.g.
 * "Ca. {19|21|24} g (50 g = 235 m)" → { m: 113 } and "{1|2} nøgle (ca. 100 m pr. 50 g)" → { m: 100 }.
 * Without metres per skein it falls back to grams; ranges ("350-400 g") use the middle.
 */
function yarnAmount(p) {
  // With your own yarn: show the metres the pattern calls for (the metres needed barely change
  // with another yarn), but never the pattern's grams, which wouldn't fit your yarn.
  const own = ownYarns(p).length > 0;
  let m = 0, g = 0, allM = true, any = false;
  const num = (x) => { const [a, b] = x.split('-').map((v) => parseFloat(v.replace(',', '.'))); return b ? (a + b) / 2 : a; };
  for (const y of patternYarns(p)) {
    let t = plain(y.text || '', p.sizeIndex);
    let ratio = null;
    const r1 = t.match(/(\d+)\s*g\s*=\s*(\d+)\s*m/), r2 = t.match(/(\d+)\s*m\s*(?:pr\.?|per|\/)\s*(\d+)\s*g/);
    if (r1) ratio = { g: +r1[1], m: +r1[2] }; else if (r2) ratio = { g: +r2[2], m: +r2[1] };
    t = t.replace(/\([^)]*\)/g, '');                      // drop "(50 g = 235 m)"
    const grams = t.match(/(\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?)\s*g\b/);
    const skeins = t.match(/(\d+(?:\s*-\s*\d+)?)\s*n[øo]gle/);
    const gr = grams ? num(grams[1].replace(/\s/g, '')) : skeins && ratio ? num(skeins[1].replace(/\s/g, '')) * ratio.g : null;
    if (gr == null) continue;
    any = true; g += gr;
    if (ratio) m += (gr / ratio.g) * ratio.m; else allM = false;
  }
  if (!any || (own && !allM)) return null;
  return allM ? { value: Math.round(m), unit: 'm garn' } : { value: Math.round(g), unit: 'g garn' };
}

/** Tick every row, and count fixed repeats as all knitted. */
function tickAll(p, now) {
  p.reps = p.reps || {};
  for (const r of visibleRows(p)) {
    const t = r.repeat ? repTimes(r.repeat, p.sizeIndex) : null;
    if (t) p.reps[r.repeat.id] = Math.max(repsOf(p, r.repeat), t - 1);
    if (!p.done[r.id]) p.done[r.id] = now;
  }
}

/** The needle sizes you used: your own choice where you changed it, else the pattern's. */
function needleSizesOf(p) {
  return [...new Set((p.pattern.needles || []).map((n, i) => (p.needles || {})[i] || plain(n.size || '', p.sizeIndex)).filter(Boolean))];
}

function doneCard(p) {
  const pat = p.pattern, si = p.sizeIndex;
  const photos = photosOf(p);
  const start = startOf(p), end = p.finishedAt || Date.now();
  const sameYear = new Date(start).getFullYear() === new Date(end).getFullYear();
  const dates = `${daDate(start, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })} – ${daDate(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const days = Math.max(1, Math.round((end - start) / DAY));
  const yarn = yarnAmount(p);
  const stats = [
    { n: days, u: days === 1 ? 'dag' : 'dage' },
    { n: rowsKnitted(p), u: 'pinde' },
    yarn && { n: yarn.value, u: yarn.unit },
  ].filter(Boolean);

  const caption = daDate(end, { month: 'short', year: 'numeric' });
  const shown = photos.slice(0, 3);
  const polaroids = shown.length
    ? `<button class="polaroids n${shown.length}" id="dc-photos" aria-label="Se dine billeder (${photos.length})">
        ${shown.map((src, i) => `<span class="polaroid p${i}"><img src="${src}" alt=""></span>`).reverse().join('')}
        <span class="polaroid-cap">${esc(caption)}</span>
        ${photos.length > 3 ? `<span class="polaroid-more">+${photos.length - 3}</span>` : ''}
      </button>
      <button class="dc-add" id="dc-add">${plusIcon}Tilføj billede</button>`
    : `<button class="polaroids empty" id="dc-add">
        <span class="polaroid p0"><span class="polaroid-empty">${cameraIcon}<b>Tilføj billeder af dit strik</b></span></span>
        <span class="polaroid-cap">${esc(caption)}</span>
      </button>`;

  const needleSizes = needleSizesOf(p);
  const matRows = [
    pat.sizes.length > 1 && si != null && { ic: rulerIcon, k: 'Størrelse', v: pat.sizes[si] },
    yarnsUsed(p).length && { ic: yarnIcon, k: 'Garn', v: yarnsUsed(p).map((y) => y.name).join(' + ') },
    needleSizes.length && { ic: needleIcon, k: 'Pinde', v: needleSizes.join(' og ') },
  ].filter(Boolean);

  return `
    <section class="done-card" aria-label="Dit færdige projekt">
      <div class="dc-top">
        <span class="dc-check">${checkIcon}</span>
        <h2 class="dc-title">Tillykke, du er færdig!</h2>
        <p class="dc-dates">${esc(dates)}</p>
        <div class="dc-photos">${polaroids}</div>
        <div class="dc-stats">${stats.map((s) => `<div><b>${s.n.toLocaleString('da-DK')}</b><span>${s.u}</span></div>`).join('')}</div>
      </div>
      <div class="dc-body">
        ${matRows.length ? `<div class="dc-field">
          <h3 class="dc-label">Materialer</h3>
          <dl class="dc-mats">${matRows.map((r) => `<div>${r.ic}<dt>${r.k}</dt><dd>${esc(r.v)}</dd></div>`).join('')}</dl>
        </div>` : ''}
        <label class="dc-field"><span class="dc-label">Strikket til</span>
          <input id="dc-for" value="${esc(p.knitFor || '')}" placeholder="Fx en gave til…" autocomplete="off"></label>
        <div class="dc-field"><span class="dc-label" id="dc-fit-l">Hvordan passede den?</span>
          <div class="dc-fit" role="group" aria-labelledby="dc-fit-l">${FIT.map((f, i) =>
            `<button data-fit="${i}" aria-pressed="${p.fit === i}">${f}</button>`).join('')}</div></div>
        <label class="dc-field"><span class="dc-label">Noter</span>
          <textarea id="dc-notes" rows="3" placeholder="Hvad vil du huske til næste gang?">${esc(p.notes || '')}</textarea></label>
        <p class="dc-saved">Alt gemmes automatisk. Du kan udfylde det senere.</p>
      </div>
    </section>`;
}

function wireDoneCard(body, p) {
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(() => store.saveProject(p), 400); };
  body.querySelector('#dc-for').addEventListener('input', (e) => { p.knitFor = e.target.value; later(); });
  body.querySelector('#dc-notes').addEventListener('input', (e) => { p.notes = e.target.value; later(); });
  body.querySelectorAll('[data-fit]').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.fit;
    p.fit = p.fit === i ? null : i;                     // tap again to clear
    body.querySelectorAll('[data-fit]').forEach((x) => x.setAttribute('aria-pressed', p.fit === +x.dataset.fit));
    store.saveProject(p);
  }));
  body.querySelector('#dc-add')?.addEventListener('click', () => pickPhoto(p));
  body.querySelector('#dc-photos')?.addEventListener('click', () => openPhotos(p));
}

/** Full-screen view of your photos: swipe between them, add more or delete one. */
function openPhotos(p, start = 0) {
  const photos = photosOf(p);
  const v = document.createElement('div');
  v.className = 'viewer';
  v.setAttribute('role', 'dialog');
  v.setAttribute('aria-label', 'Dine billeder');
  v.innerHTML = `
    <div class="viewer-bar">
      <span id="v-count"></span>
      <button class="icon-btn on-brand" id="v-close" aria-label="Luk">${closeIcon}</button>
    </div>
    <div class="viewer-strip" id="v-strip">${photos.map((src, i) => `<figure><img src="${src}" alt="Billede ${i + 1} af ${photos.length}"></figure>`).join('')}</div>
    <div class="viewer-actions">
      <button class="pill" id="v-add">${plusIcon}Tilføj billede</button>
      <button class="pill danger" id="v-del">Slet billede</button>
    </div>`;
  document.body.appendChild(v);
  document.body.classList.add('no-scroll');
  const strip = v.querySelector('#v-strip');
  const idx = () => Math.round(strip.scrollLeft / strip.clientWidth);
  const count = () => { v.querySelector('#v-count').textContent = `${idx() + 1} af ${photos.length}`; };
  strip.addEventListener('scroll', count, { passive: true });
  requestAnimationFrame(() => { strip.scrollLeft = start * strip.clientWidth; count(); });
  const close = () => { v.remove(); document.body.classList.remove('no-scroll'); };
  v.querySelector('#v-close').onclick = close;
  v.querySelector('#v-add').onclick = () => { close(); pickPhoto(p); };
  v.querySelector('#v-del').onclick = async () => {
    const i = idx();
    if (!(await ask('Slet dette billede?', 'Slet billede', true))) return;
    p.photos = photos.filter((_, j) => j !== i);
    delete p.photo;
    await store.saveProject(p);
    close();
    const y = window.scrollY;
    await route();
    window.scrollTo(0, y);
    if (p.photos.length) openPhotos(p, Math.min(i, p.photos.length - 1));
  };
}

function projectMenu(project, tab) {
  const wake = store.getSetting('wakeLock', false);
  openSheet(project.pattern.title, [
    { label: 'Tilføj billede', action: () => pickPhoto(project) },
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
        if (!(await ask(`Slet projektet "${project.pattern.title}"? Det kan ikke fortrydes. Opskriften bliver i Opskrifter.`, 'Slet projekt', true))) return;
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
  if (m) return renderProject(m[1], m[2]);
  if (location.hash === '#/om') return renderAbout();
  const garn = GU.route(location.hash);
  if (garn) return garn;
  return renderHome(location.hash === '#/opskrifter' ? 'opskrifter' : 'projekter');
}
window.addEventListener('hashchange', route);

/* ---------- icons ---------- */

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

const plusIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const cameraIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
const needleIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 19L19 5M8 20l13-13"/></svg>';
const closeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const fileIcon = '<svg class="file-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 12v6M9 15l3 3 3-3"/></svg>';
const bookOutline = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z"/><path d="M20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"/></svg>';
const chevronRight = '<svg class="rec-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

const searchIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg>';
const mailIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';

/* ---------- start ---------- */

// The Garnvælger (garn-ui.js) borrows these from here.
GU.init({
  app, store, esc, go, toast, openSheet, daDate, isFinished, yarnAmount, patternYarns, ownYarns, releaseWakeLock,
  tabbar, homeHeader, wireHomeHeader,
  icons: { back: backIcon, chevronRight, check: checkIcon },
  recipeThumb: (r) => (r.pattern.photo ? `<img class="rec-pic" src="${r.pattern.photo}" alt="">` : '<span class="rec-pic rec-empty"><img src="icons/knot.png" alt=""></span>'),
  projectThumb: (p) => { const ph = photosOf(p)[0] || p.pattern.photo; return ph ? `<img class="rec-pic" src="${ph}" alt="">` : '<span class="rec-pic rec-empty"><img src="icons/knot.png" alt=""></span>'; },
  /** "Størrelse 3-6 mdr. på 3 mm pinde. Den blev lidt lille." */
  knitSentence: (p) => {
    const size = p.sizeIndex != null && p.pattern.sizes.length > 1 ? `Størrelse ${p.pattern.sizes[p.sizeIndex]}` : '';
    const needles = needleSizesOf(p).join(' og ');
    const first = [size, needles && `${size ? 'på' : 'På'} ${needles} pinde`].filter(Boolean).join(' ');
    return [first && (first.endsWith('.') ? first : `${first}.`), p.fit != null && `Den ${FIT_PHRASE[p.fit]}.`].filter(Boolean).join(' ') || 'Færdig';
  },
});

route();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
