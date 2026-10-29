// storage.js — the ONLY file that knows where data is saved.
//
// Version 1.1: projects, patterns and your own yarns are saved in the phone's browser database
// (IndexedDB), which has room for hundreds of megabytes. Until 28 Oct 2026 they were kept in
// localStorage, which only holds about 5 MB: a few patterns with photos filled it up. The first time
// this version opens, everything is moved over from localStorage and the old space is freed.
// Version 2: we replace the inside of these functions with database calls
// (e.g. Supabase). The rest of the app only calls these functions, so it
// won't need to change. That's why they are all `async` already — database
// calls take time, so the app is written to wait for them.

const DB_NAME = 'maskemakker';
const DB_VERSION = 1;
const STORES = ['projects', 'recipes', 'yarns'];
// Where the data used to be (localStorage), moved over once
const OLD_KEYS = { projects: 'strik.projects.v1', recipes: 'strik.recipes.v1', yarns: 'strik.yarns.v1' };
const SETTINGS_KEY = 'strik.settings.v1';

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = (t) => new Promise((resolve, reject) => {
  t.oncomplete = () => resolve();
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error || new Error('Kunne ikke gemme'));
});

let opening = null;
function db() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }).then(moveFromLocalStorage);
    // Ask the phone not to clear the data when space runs low (home-screen apps usually get this)
    navigator.storage?.persist?.().catch(() => {});
  }
  return opening;
}

/** One-time move from localStorage. The old copy is only removed after the new one is safely saved. */
async function moveFromLocalStorage(d) {
  for (const [store, key] of Object.entries(OLD_KEYS)) {
    let raw = null;
    try { raw = localStorage.getItem(key); } catch { /* no localStorage */ }
    if (!raw) continue;
    let items = [];
    try { items = Object.values(JSON.parse(raw) || {}); } catch { continue; }
    const t = d.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const it of items) if (it && it.id) s.put(it);
    await done(t);
    localStorage.removeItem(key);
  }
  return d;
}

async function all(store) { return req((await db()).transaction(store).objectStore(store).getAll()); }
async function one(store, id) { return (await req((await db()).transaction(store).objectStore(store).get(id))) || null; }
async function put(store, obj) {
  const t = (await db()).transaction(store, 'readwrite');
  t.objectStore(store).put(obj);
  await done(t);
  return obj;
}
async function remove(store, id) {
  const t = (await db()).transaction(store, 'readwrite');
  t.objectStore(store).delete(id);
  await done(t);
}

/* ----- Projects ----- */

/** All projects, most recently used first. */
export async function listProjects() {
  return (await all('projects')).sort((a, b) => b.updated - a.updated);
}

/** One project by id, or null. */
export async function getProject(id) {
  return one('projects', id);
}

/** Create or update a project. */
export async function saveProject(project) {
  project.updated = Date.now();
  return put('projects', project);
}

/** Delete a project for good. */
export async function deleteProject(id) {
  return remove('projects', id);
}

/* ----- Recipe library (MM-9) -----
   Every imported pattern is kept here, so a new project can start from it later.
   A project keeps its own copy of the pattern, so deleting a recipe never touches projects. */

/** All recipes, most recently used or added first. */
export async function listRecipes() {
  return (await all('recipes')).sort((a, b) => (b.used || b.added) - (a.used || a.added));
}

export async function getRecipe(id) {
  return one('recipes', id);
}

export async function saveRecipe(recipe) {
  recipe.updated = Date.now();
  return put('recipes', recipe);
}

export async function deleteRecipe(id) {
  return remove('recipes', id);
}

/* ----- Your own yarns in the garnkatalog -----
   Yarns you add yourself, in the same format as yarns.json, so they can be searched,
   compared and suggested like the others. */

export async function listYarns() {
  return (await all('yarns')).sort((a, b) => (a.created || 0) - (b.created || 0));
}

export async function saveYarn(yarn) {
  yarn.updated = Date.now();
  return put('yarns', yarn);
}

export async function deleteYarn(id) {
  return remove('yarns', id);
}

// Small device settings (like "keep screen on"). These stay in localStorage on the
// device even in version 2 — they're small and about this phone, not your knitting.
export function getSetting(name, fallback) {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    return name in s ? s[name] : fallback;
  } catch {
    return fallback;
  }
}

export function setSetting(name, value) {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch {}
  s[name] = value;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
