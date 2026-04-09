# json-util

A fast, offline JSON formatter, validator, tree viewer, and diff tool.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Build

```bash
npm run build
npm run preview   # test the production build locally
```

## Deploy to Vercel

**Option A — Vercel CLI:**
```bash
npm i -g vercel
vercel          # follow prompts; auto-detects Vite
```

**Option B — Vercel Dashboard:**
1. Push the repo to GitHub/GitLab/Bitbucket
2. Import the repo at vercel.com/new
3. Framework will be auto-detected as Vite
4. Click Deploy — done

## Project structure

```
src/
  components/
    JsonEditor.jsx   — textarea with line numbers + error highlight
    TreeView.jsx     — collapsible recursive tree
    DiffView.jsx     — side-by-side & inline diff rendering
    SavedPanel.jsx   — localStorage save/load/delete UI
    Toast.jsx        — toast notification display
  hooks/
    useTheme.js      — dark/light toggle, persisted to localStorage
    useToast.js      — ephemeral toast queue
  pages/
    FormatterPage.jsx — format / minify / validate / tree / save
    ComparePage.jsx   — two-panel JSON diff
  utils/
    json.js          — parseJSON, formatJSON, minifyJSON, getStats
    diff.js          — recursive diffJSON algorithm
    storage.js       — localStorage read/write helpers
  App.jsx            — tab routing + header
  main.jsx           — React root
  styles.css         — all styles (CSS variables, light + dark theme)
```
