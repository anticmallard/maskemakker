// garn.js — the Garnvælger's yarn catalogue and matching rules (no screens here, see garn-ui.js).
//
// Main idea: two yarns can replace each other when they knit to the same thickness.
// - Smooth yarns are measured by metres per 50 g, which means the same for every brand
//   (brands label gauge differently: Drops Flora 210 m = 24 m, Sandnes Tynn Peer Gynt 205 m = 27 m).
// - Airy, brushed, bouclé and mohair yarns use their own gauge, since their metres say little
//   (Kid-Silk: 420 m per 50 g but knits like a thin yarn).
// - Two strands held together: thickness adds like cross-sections → sts = 1/√(1/a² + 1/b²),
//   which matches the DROPS rule "2 × group A ≈ group C".

let catalog = null;
let official = [];   // the yarns from yarns.json; your own yarns are added on top

/** Adds the yarns you have added yourself (from storage) to the catalogue and the matching. */
export function useOwnYarns(list) {
  if (!catalog) return;
  catalog.yarns = [...official, ...list.map((y) => ({ ...y, own: true }))];
  prepare(catalog);
}
export const ownCount = () => (catalog ? catalog.yarns.length - official.length : 0);
export const officialCount = () => official.length;
/** Loads yarns.json once. */
export async function loadCatalog() {
  if (!catalog) {
    const res = await fetch('yarns.json');
    if (!res.ok) throw new Error('Garnkataloget kunne ikke hentes');
    catalog = await res.json();
    official = catalog.yarns;
    prepare(catalog);
  }
  return catalog;
}

const mid = (r) => (r ? (r[0] + r[1]) / 2 : null);
const FAMILY = [[/bomuld/, 'bomuld'], [/merino|lammeuld|uld/, 'uld'], [/alpaka/, 'alpaka'], [/mohair/, 'mohair'], [/kashmir/, 'kashmir'],
  [/silke/, 'silke'], [/hør/, 'hør'], [/viskose|cupro/, 'viskose'], [/polyamid|nylon|polyester|metal/, 'syntetisk']];
const fam = (name) => (FAMILY.find(([re]) => re.test(name.toLowerCase())) || [null, 'andet'])[1];
export function families(fibre) {
  const out = {};
  for (const f of fibre || []) out[fam(f.fibre)] = (out[fam(f.fibre)] || 0) + f.pct;
  return out;
}
/** The main fibre family, e.g. "uld" for 65 % uld, 35 % alpaka. */
export const mainFibre = (y) => Object.entries(families(y.fibre)).sort((a, b) => b[1] - a[1])[0]?.[0] || 'andet';
const fibreSim = (a, b) => { let s = 0; for (const k in a) s += Math.min(a[k], b[k] || 0); return s / 100; };

export const TYPE = { glat: 'Glat', luftig: 'Luftig', boucle: 'Bouclé', borstet: 'Børstet', mohair: 'Mohair', effekt: 'Effekttråd' };
export const FIBRES = ['uld', 'alpaka', 'bomuld', 'mohair', 'kashmir', 'silke', 'hør'];

/** For smooth yarns, gauge follows thickness: sts ≈ k · (m per 50 g)^p, fitted on the catalogue. */
function fitGauge(yarns) {
  const pts = yarns.filter((y) => y.structure === 'glat' && y.sts).map((y) => [Math.log(y.m50), Math.log(mid(y.sts))]);
  const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  const p = pts.reduce((s, q) => s + (q[0] - mx) * (q[1] - my), 0) / pts.reduce((s, q) => s + (q[0] - mx) ** 2, 0);
  const k = Math.exp(my - p * mx);
  return (m50) => k * m50 ** p;
}
const together = (a, b) => 1 / Math.sqrt(1 / a ** 2 + 1 / b ** 2);

let est = null, single = [], combos = [];
function prepare(cat) {
  est = fitGauge(cat.yarns);
  for (const y of cat.yarns) {
    y.thick = y.structure === 'glat' ? est(y.m50) : mid(y.sts);   // stitches per 10 cm, brand-neutral
    y.fam = families(y.fibre);
  }
  single = cat.yarns.filter((y) => y.structure !== 'effekt' && y.thick).map((y) => ({ yarns: [y], sts: y.thick, m50: y.m50, structure: y.structure, fam: y.fam }));
  const isCarry = (y) => (y.structure === 'mohair' && mid(y.sts) >= 20) || /folgetrad/.test(y.id);
  const carry = cat.yarns.filter(isCarry);
  combos = [];
  for (const s of single) {
    const b = s.yarns[0];
    if (!['glat', 'luftig'].includes(b.structure) || s.sts < 20 || isCarry(b)) continue;
    combos.push({ yarns: [b, b], double: true, sts: together(s.sts, s.sts), m50: b.m50 / 2, structure: b.structure, fam: b.fam });
    for (const c of carry) {
      if (c.brand !== b.brand) continue;   // combinations within one brand
      const f = {};
      for (const k of new Set([...Object.keys(b.fam), ...Object.keys(c.fam)])) f[k] = ((b.fam[k] || 0) * 2 + (c.fam[k] || 0)) / 3;
      combos.push({ yarns: [b, c], sts: together(s.sts, c.thick), m50: 1 / (1 / b.m50 + 1 / c.m50), structure: c.structure === 'mohair' ? 'mohair' : b.structure, fam: f });
    }
  }
}

export const catalogYarns = () => catalog?.yarns || [];
export const catalogUpdated = () => catalog?.updated;
export const byId = (id) => catalog?.yarns.find((y) => y.id === id) || null;
export const thickFromM50 = (m50) => est(m50);

/**
 * A yarn reference is { id } for a catalogue yarn or { custom: { name, brand, g, m, fibre } }
 * for one you typed yourself (fibre is a family such as "uld", or "").
 * Turns one or two references (held together) into what the matching compares against.
 */
export function targetOf(ref, withRef = null) {
  const one = (r) => {
    if (r.id) { const y = byId(r.id); return y && { m50: y.m50, sts: y.thick, structure: y.structure, fibre: y.fibre, id: y.id }; }
    const c = r.custom, m50 = c.m * 50 / c.g;
    return { m50, sts: est(m50), structure: 'glat', fibre: c.fibre ? [{ pct: 100, fibre: c.fibre }] : null };
  };
  const a = one(ref);
  if (!a) return null;
  if (!withRef) return a;
  const b = one(withRef);
  if (!b) return null;
  const fibre = a.fibre && b.fibre ? [...a.fibre.map((f) => ({ pct: f.pct * 2 / 3, fibre: f.fibre })), ...b.fibre.map((f) => ({ pct: f.pct / 3, fibre: f.fibre }))] : null;
  return { sts: together(a.sts, b.sts), structure: b.structure === 'mohair' || a.structure === 'mohair' ? 'mohair' : a.structure, fibre, ids: [ref.id, withRef.id].filter(Boolean), combo: true };
}

/** Scores one candidate against a target; null when it isn't close enough. */
function score(c, t) {
  const tStruct = t.structure || 'glat';
  const tSts = t.m50 && tStruct === 'glat' ? est(t.m50) : t.sts;
  const sameKind = !t.combo && t.m50 && c.structure === tStruct && c.m50 && (tStruct === 'glat' || tStruct === 'mohair');
  const cT = sameKind ? est(c.m50) : c.sts, tT = sameKind ? est(t.m50) : tSts;
  const rel = Math.abs(cT - tT) / tT;   // about ±3 % thickness ≈ ±6 % metres
  if (rel > 0.11) return null;
  let s = rel * 20;
  const why = [rel <= 0.025 ? 'Samme tykkelse' : cT > tT ? 'Lidt tyndere' : 'Lidt tykkere'];
  if (sameKind) why[0] += ` (${Math.round(c.m50)} m mod ${Math.round(t.m50)} m pr. 50 g)`;
  if (c.structure !== tStruct) {
    s += { glat_luftig: 0.6, luftig_glat: 0.6, glat_mohair: 1.6, mohair_glat: 1.4 }[`${tStruct}_${c.structure}`] ?? 1.2;
    why.push({ luftig: 'luftigt garn, lettere og blødere', mohair: 'med mohair, får en let glorie', borstet: 'børstet, blødt og fnugget', boucle: 'bouclé, krøllet overflade', glat: 'glat garn, tydeligere masker' }[c.structure]);
  }
  if (t.fibre && Object.keys(c.fam).length) {   // unknown fibre on either side: no comparison
    const sim = fibreSim(families(t.fibre), c.fam);
    s += (1 - sim) * 2;
    why.push(sim >= 0.9 ? 'samme fiber' : sim >= 0.5 ? 'næsten samme fiber' : 'anden fiber');
  }
  if (c.yarns.length > 1) { s += 0.5; why.push(c.double ? 'dobbelt tråd' : 'to garner holdt sammen'); }
  const rating = s < 0.7 ? 'very' : s < 1.5 ? 'good' : 'try';
  return { ...c, score: s, rating, why: why.filter(Boolean), thicker: cT < tT, diff: rel };
}

export const RATING = { very: 'Meget tæt på', good: 'Godt alternativ', try: 'Strik en prøve' };

/** Best matches for a target. */
export function alternatives(t, { limit = 12, withCombos = false } = {}) {
  if (!t) return [];
  const list = t.combo || withCombos ? [...single, ...combos] : single;
  const out = [];
  for (const c of list) {
    if (t.id && c.yarns.length === 1 && c.yarns[0].id === t.id) continue;
    if (t.ids && c.yarns.map((y) => y.id).sort().join() === [...t.ids].sort().join()) continue;
    const r = score(c, t);
    if (r) out.push(r);
  }
  return out.sort((a, b) => a.score - b.score).slice(0, limit);
}

/** How well one catalogue yarn fits a target (for "Hvad kan jeg strikke?"). */
export function rateYarn(yarnId, t) {
  const c = single.find((s) => s.yarns[0].id === yarnId);
  if (!c || !t) return null;
  if (t.id === yarnId) return { ...c, score: 0, rating: 'same', why: ['Opskriftens eget garn'] };
  return score(c, t);
}

/** How well a yarn you typed yourself fits a target. */
export function rateRef(ref, t) {
  if (ref.id) return rateYarn(ref.id, t);
  const c = ref.custom, m50 = (c.m * 50) / c.g;
  const fibre = c.fibre ? [{ pct: 100, fibre: c.fibre }] : [];
  const y = { id: null, name: c.name, brand: c.brand, m50, skein: { g: c.g, m: c.m }, structure: 'glat', fibre };
  return t ? score({ yarns: [y], sts: est(m50), m50, structure: 'glat', fam: families(fibre) }, t) : null;
}

/** Skeins needed; each strand needs the full length. */
export function skeins(yarns, metres) {
  const per = new Map();
  for (const y of yarns) per.set(y, (per.get(y) || 0) + metres);
  return [...per].map(([y, m]) => ({ y, n: y.skein ? Math.ceil(m / y.skein.m) : null, g: y.skein?.g }));
}

/** "(50 g = 175 m)", "25 g = 115 m", "100 m pr. 50 g" → { g, m } */
export function ratioOf(text) {
  const t = String(text || '');
  const a = t.match(/(\d+(?:[.,]\d+)?)\s*g\s*=\s*(\d+)\s*m/), b = t.match(/(\d+)\s*m\s*(?:pr\.?|per|\/)\s*(\d+)\s*g/);
  if (a) return { g: parseFloat(a[1].replace(',', '.')), m: +a[2] };
  if (b) return { g: +b[2], m: +b[1] };
  return null;
}

const norm = (s) => String(s || '').toLowerCase().replace(/^drops\s+/, '').replace(/[^a-zæøå0-9]+/g, ' ').trim();
/**
 * A pattern's yarn line, e.g. { name: "Sunday fra Sandnes Garn", text: "… (50 g = 235 m)" }
 * → { id } when it is in the catalogue, else { custom } with its metres, or null.
 */
export function resolvePatternYarn(y) {
  const [name, brand = ''] = String(y.name || '').split(/\s+fra\s+/i);
  const nb = norm(brand), nn = norm(name);
  const hit = catalog.yarns.find((c) => norm(c.name) === nn && (!nb || norm(c.brand).includes(nb.split(' ')[0]) || nb.includes(norm(c.brand).split(' ')[0])));
  if (hit) return { id: hit.id };
  const r = ratioOf(y.text);
  return r ? { custom: { name: name.trim(), brand: brand.trim(), g: r.g, m: r.m, fibre: '' } } : null;
}

/** Thickness groups for the catalogue, thinnest first. */
export const BANDS = [
  { min: 27, label: 'Tyndt', needle: 'pind 2½–3' },
  { min: 23, label: 'Tyndt til mellem', needle: 'pind 3–3½' },
  { min: 19, label: 'Mellem', needle: 'pind 3½–4½' },
  { min: 15, label: 'Tykt', needle: 'pind 5–6' },
  { min: 11, label: 'Meget tykt', needle: 'pind 7–8' },
  { min: 0, label: 'Ekstra tykt', needle: 'pind 9 og op' },
];
export const bandOf = (y) => (y.thick ? BANDS.findIndex((b) => y.thick >= b.min) : BANDS.length);
