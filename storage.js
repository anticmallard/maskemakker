// storage.js — the ONLY file that knows where data is saved.
//
// Version 1: everything is saved in the phone's browser (localStorage).
// Version 2: we replace the inside of these functions with database calls
// (e.g. Supabase). The rest of the app only calls these functions, so it
// won't need to change. That's why they are all `async` already — database
// calls take time, so the app is written to wait for them.

const PROJECTS_KEY = 'strik.projects.v1';
const SETTINGS_KEY = 'strik.settings.v1';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(PROJECTS_KEY)) || {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(all));
}

/** All projects, most recently used first. */
export async function listProjects() {
  return Object.values(readAll()).sort((a, b) => b.updated - a.updated);
}

/** One project by id, or null. */
export async function getProject(id) {
  return readAll()[id] || null;
}

/** Create or update a project. */
export async function saveProject(project) {
  const all = readAll();
  project.updated = Date.now();
  all[project.id] = project;
  writeAll(all);
  return project;
}

/** Delete a project for good. */
export async function deleteProject(id) {
  const all = readAll();
  delete all[id];
  writeAll(all);
}

// ----- Recipe library (MM-9) -----
// Every imported pattern is kept here, so a new project can start from it later.
// A project keeps its own copy of the pattern, so deleting a recipe never touches projects.
const RECIPES_KEY = 'strik.recipes.v1';

function readRecipes() {
  try {
    return JSON.parse(localStorage.getItem(RECIPES_KEY)) || {};
  } catch {
    return {};
  }
}

/** All recipes, most recently used or added first. */
export async function listRecipes() {
  return Object.values(readRecipes()).sort((a, b) => (b.used || b.added) - (a.used || a.added));
}

export async function getRecipe(id) {
  return readRecipes()[id] || null;
}

export async function saveRecipe(recipe) {
  const all = readRecipes();
  recipe.updated = Date.now();
  all[recipe.id] = recipe;
  localStorage.setItem(RECIPES_KEY, JSON.stringify(all));
  return recipe;
}

export async function deleteRecipe(id) {
  const all = readRecipes();
  delete all[id];
  localStorage.setItem(RECIPES_KEY, JSON.stringify(all));
}

// Small device settings (like "keep screen on"). These stay on the
// device even in version 2 — they're about this phone, not your knitting.
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
