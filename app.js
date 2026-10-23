// app.js — screens and interaction. All saving goes through storage.js.
import * as store from './storage.js';

const app = document.getElementById('app');
const fileInput = document.getElementById('file-input');
const sheet = document.getElementById('sheet');

/* ---------- helpers ---------- */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/**
 * Turns pattern text into HTML:
 *  {88|100|112}      → the number for the chosen size (all of them if none chosen)
 *  [Video](https://…) → a live link
 *  **tekst**          → bold
 */
function renderText(text, sizeIndex) {
  let h = esc(text);
  h = h.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, inner) => {
    const vals = inner.split('|').map((v) => v.trim());
    if (sizeIndex == null) return `<span class="num all">${vals.join(' / ')}</span>`;
    const v = vals[sizeIndex] ?? vals[vals.length - 1];
    return `<span class="num">${v === '-' ? '–' : v}</span>`;
  });
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_, t, u) => `<a href="${u}" target="_blank" rel="noopener" class="link">${playIcon}${t}</a>`);
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return h;
}

const playIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.5" fill="currentColor" opacity=".15"/><path d="M6.3 5v6l5-3z" fill="currentColor"/></svg>';

/** Does this item (or section) apply to the chosen size? */
const applies = (thing, si) => !thing.sizes || si == null || thing.sizes.includes(si);

const isRow = (it) => it.type === 'row' || it.type === 'measure';

/**
 * Every tickable row for the project's chosen size, in order.
 * Rows inside a repeat block get `repeat` (the block) so we know they belong together;
 * every row gets `sec` (its section's index).
 */
function visibleRows(project) {
  const si = project.sizeIndex;
  const rows = [];
  project.pattern.sections.forEach((sec, secIdx) => {
    if (!applies(sec, si)) return;
    for (const it of sec.items) {
      if (!applies(it, si)) continue;
      if (it.type === 'repeat') {
        for (const r of it.items) if (isRow(r) && applies(r, si)) rows.push({ ...r, repeat: it, sec: secIdx });
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
 * Is this row done?
 * Rows in a repeat block are cleared at each "Ny gentagelse", so for the progress bar
 * they count as done once one repeat is finished — otherwise progress would jump backwards.
 * For "next row" they only count as done when actually ticked (or the repeats are finished).
 */
function rowDone(project, r, forProgress) {
  if (project.done[r.id]) return true;
  if (r.repeat) {
    if (r.repeat.until && project.done[r.repeat.until.id]) return true;
    if (forProgress && repsOf(project, r.repeat) > 0) return true;
  }
  return false;
}

function progress(project) {
  const rows = visibleRows(project);
  const done = rows.filter((r) => rowDone(project, r, true)).length;
  const next = rows.find((r) => !rowDone(project, r, false));
  return { rows, done, total: rows.length, pct: rows.length ? Math.round((done / rows.length) * 100) : 0, next };
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

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2200);
}

/* ---------- bottom sheet ---------- */

function openSheet(title, buttons) {
  sheet.innerHTML = `
    <div class="sheet-inner">
      <div class="sheet-title">${esc(title)}</div>
      ${buttons.map((b, i) => `<button class="sheet-btn ${b.cls || ''}" data-i="${i}">${b.html ?? esc(b.label)}</button>`).join('')}
      <button class="sheet-btn cancel" data-i="-1">Annullér</button>
    </div>`;
  sheet.onclick = (e) => {
    if (e.target === sheet) return sheet.close();
    const btn = e.target.closest('[data-i]');
    if (!btn) return;
    sheet.close();
    const b = buttons[+btn.dataset.i];
    if (b) b.action();
  };
  sheet.showModal();
}

/* ---------- import ---------- */

function pickFile() {
  fileInput.value = '';
  fileInput.click();
}

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
    location.hash = `#/p/${project.id}`;
  } catch (err) {
    alert('Kunne ikke importere filen.\n\n' + err.message);
  }
});

async function createProject(pattern) {
  const project = {
    id: uid(),
    pattern,
    sizeIndex: pattern.sizes.length === 1 ? 0 : null,
    done: {},
    created: Date.now(),
  };
  return store.saveProject(project);
}

async function loadExample() {
  try {
    const res = await fetch('patterns/eksempel.json', { cache: 'no-store' });
    const project = await createProject(normalizePattern(await res.json()));
    location.hash = `#/p/${project.id}`;
  } catch {
    alert('Kunne ikke hente eksemplet.');
  }
}

async function exportBackup() {
  const projects = await store.listProjects();
  const blob = new Blob([JSON.stringify({ kind: 'strik-backup', exported: new Date().toISOString(), projects }, null, 2)],
    { type: 'application/json' });
  const file = new File([blob], `strik-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- home screen ---------- */

async function renderHome() {
  releaseWakeLock();
  const projects = await store.listProjects();

  const cards = projects.map((p) => {
    const pr = progress(p);
    const size = p.sizeIndex == null ? 'Vælg størrelse' : p.pattern.sizes[p.sizeIndex];
    const status = pr.total && pr.done === pr.total
      ? '<span class="done-badge">Færdig</span>'
      : pr.next ? `Næste: ${esc(stripMarkup(pr.next.label || 'pind'))}` : '';
    return `
      <a class="card" href="#/p/${p.id}">
        <div class="card-top">
          <div>
            <div class="card-title">${esc(p.pattern.title)}</div>
            <div class="card-meta">${esc(p.pattern.designer || '')}${p.pattern.designer ? ' · ' : ''}${esc(size)}</div>
          </div>
          <div class="ring" style="--p:${pr.pct}"><span>${pr.pct}%</span></div>
        </div>
        <div class="bar"><div style="width:${pr.pct}%"></div></div>
        <div class="card-foot"><span>${pr.done} af ${pr.total} pinde</span><span>${status}</span></div>
      </a>`;
  }).join('');

  app.innerHTML = `
    <header class="home-head">
      <h1>Strik</h1>
      <button class="icon-btn" id="home-menu" aria-label="Menu">${dotsIcon}</button>
    </header>
    <main class="home">
      ${projects.length ? `<div class="cards">${cards}</div>` : `
        <div class="empty">
          <div class="empty-art">${yarnArt}</div>
          <h2>Ingen projekter endnu</h2>
          <p>Importér en opskrift for at komme i gang.</p>
          <button class="link-btn" id="example">Prøv med en eksempelopskrift</button>
        </div>`}
    </main>
    <div class="dock"><button class="primary" id="import">＋ Importér opskrift</button></div>`;

  app.querySelector('#import').onclick = pickFile;
  app.querySelector('#example')?.addEventListener('click', loadExample);
  app.querySelector('#home-menu').onclick = () => openSheet('Strik', [
    { label: 'Importér opskrift eller backup', action: pickFile },
    { label: 'Gem backup af alle projekter', action: exportBackup },
    { label: 'Tilføj eksempelopskrift', action: loadExample },
  ]);
}

const stripMarkup = (s) => String(s).replace(/\{([^{}]*)\}/g, (_, x) => x.split('|')[0]);

/* ---------- project screen ---------- */

async function renderProject(id) {
  const project = await store.getProject(id);
  if (!project) { location.hash = '#/'; return; }
  const pat = project.pattern;
  const si = project.sizeIndex;

  const info = (pat.info || []).map((r) =>
    `<div class="info-row"><dt>${esc(r.label)}</dt><dd>${renderText(r.text, si)}</dd></div>`).join('');

  const rowHtml = (it) => {
    const done = !!project.done[it.id];
    return `
      <div class="row ${it.type === 'measure' ? 'measure' : ''} ${done ? 'done' : ''}" data-id="${it.id}" role="checkbox" aria-checked="${done}" tabindex="0">
        <span class="check">${checkIcon}</span>
        <span class="row-body">
          ${it.label ? `<span class="row-label">${it.type === 'measure' ? rulerIcon : ''}${renderText(it.label, si)}</span>` : ''}
          <span class="row-text">${renderText(it.text, si)}</span>
        </span>
      </div>`;
  };

  const repeatHtml = (it) => `
    <div class="repeat" data-rep="${it.id}">
      <div class="rep-head">
        <span class="rep-title">${repeatIcon}${esc(it.label || 'Gentages')}</span>
        <span class="rep-count"></span>
      </div>
      ${it.items.filter((r) => applies(r, si)).map((r) =>
        r.type === 'text' ? `<p class="note">${renderText(r.text, si)}</p>` : rowHtml(r)).join('')}
      <div class="rep-foot">
        <button class="rep-undo" aria-label="Én gentagelse tilbage">−</button>
        <button class="rep-new">Ny gentagelse ↻</button>
      </div>
    </div>
    ${it.until ? rowHtml(it.until) : ''}`;

  const sections = pat.sections.map((sec, secIdx) => {
    if (!applies(sec, si)) return '';
    const items = sec.items.filter((it) => applies(it, si)).map((it) => {
      if (it.type === 'text') return `<p class="note">${renderText(it.text, si)}</p>`;
      if (it.type === 'repeat') return repeatHtml(it);
      return rowHtml(it);
    }).join('');
    return `
      <section class="sec" data-sec="${secIdx}">
        <h2 class="sec-head"><span>${esc(sec.title)}</span><span class="sec-count"></span></h2>
        ${items}
      </section>`;
  }).join('');

  // All repeat blocks in this pattern, by id
  const repeats = {};
  pat.sections.forEach((s) => s.items.forEach((it) => { if (it.type === 'repeat') repeats[it.id] = it; }));
  const blockRows = (rep) => rep.items.filter((r) => isRow(r) && applies(r, project.sizeIndex));

  app.innerHTML = `
    <header class="proj-head">
      <div class="proj-bar">
        <a class="icon-btn" href="#/" aria-label="Tilbage">${backIcon}</a>
        <div class="proj-title">${esc(pat.title)}</div>
        <button class="icon-btn" id="proj-menu" aria-label="Menu">${dotsIcon}</button>
      </div>
      <div class="proj-progress">
        <button class="size-chip ${si == null ? 'empty' : ''}" id="size">${si == null ? 'Vælg størrelse' : 'Str. ' + esc(pat.sizes[si])} ▾</button>
        <div class="bar"><div id="pbar"></div></div>
        <span class="pct" id="ptext"></span>
      </div>
    </header>
    <main class="proj ${si == null ? 'no-size' : ''}">
      ${pat.designer || pat.intro ? `<div class="intro">
        ${pat.designer ? `<div class="designer">${esc(pat.designer)}</div>` : ''}
        ${pat.intro ? `<p>${renderText(pat.intro, si)}</p>` : ''}
      </div>` : ''}
      ${info ? `<details class="info"><summary>Garn, pinde og strikkefasthed</summary><dl>${info}</dl></details>` : ''}
      ${sections}
      <div class="end-space"></div>
    </main>
    <button class="next-btn" id="next">Gå til næste pind ↓</button>`;

  const updateCounts = () => {
    const pr = progress(project);
    app.querySelector('#pbar').style.width = pr.pct + '%';
    app.querySelector('#ptext').textContent = `${pr.done}/${pr.total}`;
    app.querySelectorAll('.sec').forEach((secEl) => {
      const secRows = pr.rows.filter((r) => r.sec === +secEl.dataset.sec);
      const d = secRows.filter((r) => rowDone(project, r, true)).length;
      secEl.querySelector('.sec-count').textContent = secRows.length ? `${d}/${secRows.length}` : '';
      secEl.classList.toggle('complete', secRows.length > 0 && d === secRows.length);
    });
    app.querySelectorAll('.repeat').forEach((el) => {
      const rep = repeats[el.dataset.rep];
      const n = repsOf(project, rep);
      const finished = rep.until && project.done[rep.until.id];
      const allTicked = blockRows(rep).every((r) => project.done[r.id]);
      el.querySelector('.rep-count').textContent = finished
        ? `Færdig · ${n + (allTicked ? 1 : 0)} ${n + (allTicked ? 1 : 0) === 1 ? 'gentagelse' : 'gentagelser'}`
        : `Gentagelse ${n + 1}`;
      el.classList.toggle('finished', !!finished);
      el.querySelector('.rep-new').classList.toggle('ready', allTicked && !finished);
      el.querySelector('.rep-undo').hidden = n === 0;
    });
    app.querySelector('#next').hidden = !pr.next;
  };
  updateCounts();

  // Start the next repeat: count it, clear the block's ticks
  const newRepeat = async (el) => {
    const rep = repeats[el.dataset.rep];
    const rows = blockRows(rep);
    if (!rows.every((r) => project.done[r.id]) &&
        !confirm('Ikke alle pinde i gentagelsen er krydset af. Start ny gentagelse alligevel?')) return;
    project.reps = project.reps || {};
    project.reps[rep.id] = repsOf(project, rep) + 1;
    for (const r of rows) delete project.done[r.id];
    if (rep.until) delete project.done[rep.until.id];
    el.querySelectorAll('.row.done').forEach((r) => { r.classList.remove('done'); r.setAttribute('aria-checked', false); });
    app.querySelector(`.row[data-id="${rep.until?.id}"]`)?.classList.remove('done');
    updateCounts();
    await store.saveProject(project);
    toast(`Gentagelse ${project.reps[rep.id] + 1}`);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Step the counter back one (if you tapped "Ny gentagelse" by mistake)
  const undoRepeat = async (el) => {
    const rep = repeats[el.dataset.rep];
    if (!repsOf(project, rep)) return;
    project.reps[rep.id] -= 1;
    updateCounts();
    await store.saveProject(project);
    toast(`Tilbage til gentagelse ${project.reps[rep.id] + 1}`);
  };

  // Tick / untick a row
  const toggle = async (rowEl) => {
    if (project.sizeIndex == null) { chooseSize(project); return; }
    const rid = rowEl.dataset.id;
    if (project.done[rid]) delete project.done[rid];
    else project.done[rid] = Date.now();
    rowEl.classList.toggle('done', !!project.done[rid]);
    rowEl.setAttribute('aria-checked', !!project.done[rid]);
    updateCounts();
    await store.saveProject(project);
    const pr = progress(project);
    if (pr.total && pr.done === pr.total && project.done[rid]) toast('Færdig! 🧶');
  };

  app.querySelector('main').addEventListener('click', (e) => {
    if (e.target.closest('a')) return;           // let video links open
    if (e.target.closest('.rep-new')) return newRepeat(e.target.closest('.repeat'));
    if (e.target.closest('.rep-undo')) return undoRepeat(e.target.closest('.repeat'));
    const rowEl = e.target.closest('.row');
    if (rowEl) toggle(rowEl);
  });

  app.querySelector('#size').onclick = () => chooseSize(project);
  app.querySelector('#next').onclick = () => {
    const pr = progress(project);
    const el = pr.next && app.querySelector(`.row[data-id="${pr.next.id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1200);
  };
  app.querySelector('#proj-menu').onclick = () => projectMenu(project);

  if (store.getSetting('wakeLock', false)) requestWakeLock();
  if (si == null) setTimeout(() => chooseSize(project), 250);
}

function chooseSize(project) {
  openSheet('Vælg størrelse', project.pattern.sizes.map((s, i) => ({
    html: `${esc(s)}${i === project.sizeIndex ? ' <span class="tick">✓</span>' : ''}`,
    action: async () => {
      project.sizeIndex = i;
      await store.saveProject(project);
      renderProject(project.id);
    },
  })));
}

function projectMenu(project) {
  const wake = store.getSetting('wakeLock', false);
  openSheet(project.pattern.title, [
    { label: 'Skift størrelse', action: () => chooseSize(project) },
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
        if (!confirm('Fjern alle flueben i dette projekt?')) return;
        project.done = {};
        project.reps = {};
        await store.saveProject(project);
        renderProject(project.id);
      },
    },
    {
      label: 'Slet projekt', cls: 'danger',
      action: async () => {
        if (!confirm(`Slet "${project.pattern.title}"? Det kan ikke fortrydes.`)) return;
        await store.deleteProject(project.id);
        location.hash = '#/';
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

function route() {
  const m = location.hash.match(/^#\/p\/(.+)$/);
  if (m) renderProject(m[1]);
  else renderHome();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ---------- icons ---------- */

const dotsIcon = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
const backIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
const checkIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12.5l4 4 8-9"/></svg>';
const rulerIcon = '<svg class="ruler" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2.5" y="8" width="19" height="8" rx="1.5"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/></svg>';
const repeatIcon = '<svg class="rep-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a7 7 0 0 1 12-4.9L19 9"/><path d="M19 4v5h-5"/><path d="M20 13a7 7 0 0 1-12 4.9L5 15"/><path d="M5 20v-5h5"/></svg>';
const yarnArt = '<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="60" cy="62" r="38"/><path d="M26 48c20 6 48 4 68-12M23 66c26 6 58 2 74-18M30 84c24 4 52-2 66-24M44 28c-6 22-4 52 10 70M62 24c-8 26-4 56 14 72"/><path d="M96 82c8 6 10 14 4 22"/></svg>';

/* ---------- start ---------- */

route();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
