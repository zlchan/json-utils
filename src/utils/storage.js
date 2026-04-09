const SAVES_KEY = 'jsonutil_saves'
const THEME_KEY = 'jsonutil_theme'
const LAST_KEY  = 'jsonutil_last'

export function getSaves() {
  try {
    return JSON.parse(localStorage.getItem(SAVES_KEY) || '[]')
  } catch { return [] }
}

export function addSave(label, json) {
  const saves = getSaves()
  const entry = { id: Date.now(), label, json, date: new Date().toISOString() }
  saves.unshift(entry)
  // keep last 20
  const trimmed = saves.slice(0, 20)
  localStorage.setItem(SAVES_KEY, JSON.stringify(trimmed))
  return entry
}

export function deleteSave(id) {
  const saves = getSaves().filter(s => s.id !== id)
  localStorage.setItem(SAVES_KEY, JSON.stringify(saves))
}

export function clearSaves() {
  localStorage.removeItem(SAVES_KEY)
}

export function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'light'
}

export function setTheme(t) {
  localStorage.setItem(THEME_KEY, t)
}

export function getLastJSON() {
  return localStorage.getItem(LAST_KEY) || ''
}

export function setLastJSON(json) {
  try { localStorage.setItem(LAST_KEY, json) } catch {}
}
