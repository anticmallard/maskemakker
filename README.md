# Maskemakker — knitting tracker (version 1)

A home-screen web app for iPhone. Progress is saved on the phone only.

## Files

| File | What it does |
|---|---|
| `index.html` | The page itself |
| `app.js` | Screens, tabs, ticking rows, size switching, import |
| `storage.js` | **The only file that saves data.** In version 2 we swap its insides for a database |
| `style.css` | Look and feel (light and dark mode) |
| `sw.js` | Makes the app open without internet |
| `manifest.json`, `icons/` | Home-screen name, app icon and the knot logo |
| `patterns/eksempel.json` | A sample pattern written by Claude (safe to make public) |
| `preview.html` | Only used for the preview in Claude — not needed on GitHub |

## Put it on GitHub (same as Pusletasken)

1. On github.com, create a new **public** repository, e.g. `maskemakker`.
2. Click **Add file → Upload files** and drag in everything from this folder (keep the `icons` and `patterns` folders).
3. **Settings → Pages**: Source = *Deploy from a branch*, Branch = `main`, folder `/ (root)`. Save.
4. After a minute the app is at `https://<your-username>.github.io/maskemakker/`.
5. Open that link in **Safari** on your iPhone → Share → **Add to Home Screen**.

Always use the app from the home-screen icon. Safari can clear website data after a week without visits, but home-screen apps are exempt.

If you already added the old "Strik" app to your home screen, delete that icon and add the new one, so the name and logo update.

## Adding your own patterns

**Never upload your own pattern files to GitHub** — the repo is public.

1. Send Claude the pattern PDF. Claude sends back a `.json` file.
2. Save it to the Files app (iCloud Drive or On My iPhone).
3. In the app, either:
   - tap the **Start nyt projekt** card under Projekter → **Importér ny opskrift**: the pattern is saved and a project starts, or
   - go to **Opskrifter** (bottom menu) → **Importér ny opskrift**: the pattern is only saved.

Every imported pattern stays under **Opskrifter**, so you can start a new project from it later without importing the file again. Deleting a project keeps its pattern; delete a pattern from its ••• menu under Opskrifter (your projects are kept). Importing the same pattern again updates it instead of adding a copy.

## About page and contact email

The **Om Maskemakker** page (in the ••• menu on the home screen) shows copyright info, a note that patterns belong to their designers, and a contact email. The email and version are set at the top of `app.js`: `CONTACT_EMAIL` and `APP_VERSION`.

## Backup

Menu (•••) on the home screen → **Gem backup af alle projekter**. The backup includes your patterns under Opskrifter. Save the file to iCloud Drive. Import it the same way as a pattern to restore. Do this now and then — if you delete the home-screen app, its data is gone.

## Pattern file format

```json
{
  "title": "Name",
  "designer": "Who made it",
  "intro": "Short text",
  "photo": "data:image/jpeg;base64,…",
  "sizes": ["S", "M", "L"],
  "sizeDetails": ["86 cm", "94 cm", "102 cm"],
  "sizeDetailLabel": "Brystvidde",
  "yarn": [{ "name": "Sunday fra Sandnes Garn", "text": "{3|4|5} nøgler (50 g = 235 m)" }],
  "needles": [{ "text": "Rundpind 3 mm, 60 cm", "size": "3 mm" }],
  "gauge": [{ "label": "Glatstrik", "text": "28 m = 10 cm" }],
  "techniques": [
    { "id": "udt", "name": "Udt", "text": "How it's done", "video": "https://…" }
  ],
  "sections": [
    {
      "title": "Ryg",
      "items": [
        { "type": "text",    "text": "A note that can't be ticked" },
        { "type": "row",     "label": "P 1", "side": "RS", "text": "Strik {10|12|14} r, [[udt]], 1 r" },
        { "type": "row",     "label": "P 2", "side": "VS", "text": "Strik vrang" },
        { "type": "measure", "label": "Til mål", "text": "Strik til arbejdet måler {30|32|34} cm" },
        { "type": "row",     "label": "P 5", "sizes": [2], "text": "Only shown for size L" },
        {
          "type": "repeat", "label": "Mønster · p 1–4",
          "items": [ { "type": "row", "label": "P 1", "side": "RS", "text": "…" } ],
          "until": { "type": "measure", "label": "Til mål", "text": "Gentag p 1–4 til arbejdet måler {20|22|24} cm" }
        }
      ]
    }
  ]
}
```

- `{10|12|14}` — one number per size, in the same order as `sizes`. Use `-` where a size has no value.
- `sizeDetails` — what each size means (shown on the size buttons under Materialer).
- `notions` — other things you need, e.g. buttons (shown under "Tilbehør").
- `rowMarks` — rows the app marks automatically, e.g. buttonholes: `{ "label": "Knaphul", "tech": "knaphul", "first": 4, "every": "{24|26}", "count": "{8|8}" }` marks P 4, P 28, P 52 … Works inside repeat blocks too.
- `"numberPrefix": "Omg"` on a `repeat` — count rounds instead of rows (Omg 1, Omg 2 …).
- `yarn` — one entry per yarn the pattern suggests. With more than one, you pick yours from a list under Materialer.
  Write the amount and the length per skein in `text`, e.g. `"Ca. {19|21|24} g (50 g = 235 m)"` or `"{1|2} nøgle (ca. 100 m pr. 50 g)"`. The project card on a finished project uses it to show how many metres of yarn you used (or grams, when the pattern gives no length).
- `needles` — the pattern's needles. Under Materialer you can record that you use another size ("Du bruger: 3,5 mm"); the pattern's needle stays visible and the recipe doesn't change.
- `techniques` + `[[udt]]` in a row — the word becomes tappable and opens the Teknikker tab. `[[indt-r|Indt-r]]` shows different text than the id.
- `side`: `"RS"` (retside, mustard) or `"VS"` (vrangside, lilac). Leave it out for rounds.
- `[Se video](https://…)` — a live link. `**text**` — bold.
- `"sizes": [0, 2]` on a row or section — only show it for those sizes (0 = first size).
- `"numberFrom": 16` on a `repeat` — the rows get running P numbers that keep counting with each repeat (P 16–23, then P 24–31 …). Each row's own `label` (e.g. "mønster p 1") is shown small next to it.
- Section titles follow the pattern's own headlines, and text that isn't a row goes between the rows as `text` items.
- `repeat` — a block of rows knitted over and over. Tick the rows, tap **Ny gentagelse**: ticks clear and the counter goes up. **−** steps the counter back. Ticking the `until` row ends the repeats.
- Rows like "pind 2–4" are written out as three separate rows; "til arbejdet måler X cm" is one `measure` row.

Changing a pattern file and re-importing creates a new project, because ticks are tied to row positions.
