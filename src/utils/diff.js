/**
 * Recursive JSON diff engine
 * Returns a flat list of DiffEntry for rendering
 *
 * DiffEntry: { path, type: 'added'|'removed'|'changed'|'same', oldVal, newVal, depth }
 */
export function diffJSON(a, b, path = '', depth = 0) {
  const results = []

  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) {
    // Completely different types — treat as changed root
    results.push({ path, type: 'changed', oldVal: a, newVal: b, depth })
    return results
  }

  if (typeof a !== 'object' || a === null || b === null) {
    // Primitives
    if (a !== b) {
      results.push({ path, type: 'changed', oldVal: a, newVal: b, depth })
    } else {
      results.push({ path, type: 'same', oldVal: a, newVal: b, depth })
    }
    return results
  }

  // Objects / Arrays
  const aKeys = Array.isArray(a) ? a.map((_, i) => i) : Object.keys(a)
  const bKeys = Array.isArray(b) ? b.map((_, i) => i) : Object.keys(b)

  const allKeys = [...new Set([...aKeys.map(String), ...bKeys.map(String)])]

  for (const key of allKeys) {
    const childPath = path ? `${path}.${key}` : key
    const aHas = Array.isArray(a) ? parseInt(key) < a.length : Object.prototype.hasOwnProperty.call(a, key)
    const bHas = Array.isArray(b) ? parseInt(key) < b.length : Object.prototype.hasOwnProperty.call(b, key)

    if (aHas && !bHas) {
      results.push({ path: childPath, type: 'removed', oldVal: a[key], newVal: undefined, depth: depth + 1 })
    } else if (!aHas && bHas) {
      results.push({ path: childPath, type: 'added', oldVal: undefined, newVal: b[key], depth: depth + 1 })
    } else {
      // Both have the key — recurse
      const aVal = a[key], bVal = b[key]
      if (
        typeof aVal === 'object' && aVal !== null &&
        typeof bVal === 'object' && bVal !== null
      ) {
        results.push(...diffJSON(aVal, bVal, childPath, depth + 1))
      } else if (aVal !== bVal) {
        results.push({ path: childPath, type: 'changed', oldVal: aVal, newVal: bVal, depth: depth + 1 })
      } else {
        results.push({ path: childPath, type: 'same', oldVal: aVal, newVal: bVal, depth: depth + 1 })
      }
    }
  }

  return results
}

export function diffSummary(entries) {
  return {
    added: entries.filter(e => e.type === 'added').length,
    removed: entries.filter(e => e.type === 'removed').length,
    changed: entries.filter(e => e.type === 'changed').length,
  }
}

/** Build a side-by-side line representation of a JSON string with diff highlights */
export function buildSideBySideLines(aStr, bStr, diffEntries) {
  const changedPaths = new Set(diffEntries.filter(e => e.type !== 'same').map(e => e.path))
  const typemap = {}
  for (const e of diffEntries) typemap[e.path] = e.type

  function annotate(obj, path = '') {
    if (typeof obj !== 'object' || obj === null) {
      const type = typemap[path]
      return [{ text: JSON.stringify(obj), path, type: type || 'same' }]
    }
    const lines = []
    const isArr = Array.isArray(obj)
    lines.push({ text: isArr ? '[' : '{', path, type: 'bracket' })
    const entries = isArr ? obj.map((v, i) => [i, v]) : Object.entries(obj)
    for (const [k, v] of entries) {
      const childPath = path ? `${path}.${k}` : String(k)
      const type = typemap[childPath] || 'same'
      if (typeof v === 'object' && v !== null) {
        const prefix = isArr ? '' : `"${k}": `
        const nested = annotate(v, childPath)
        nested[0] = { ...nested[0], text: prefix + nested[0].text }
        lines.push(...nested)
      } else {
        const text = isArr ? JSON.stringify(v) : `"${k}": ${JSON.stringify(v)}`
        lines.push({ text, path: childPath, type })
      }
    }
    lines.push({ text: isArr ? ']' : '}', path, type: 'bracket' })
    return lines
  }

  return { aLines: annotate(JSON.parse(aStr)), bLines: annotate(JSON.parse(bStr)) }
}
