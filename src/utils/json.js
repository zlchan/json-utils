/**
 * Parse JSON and return { data, error }
 * error: { message, line, column } or null
 */
export function parseJSON(str) {
  if (!str || !str.trim()) return { data: null, error: null }
  try {
    const data = JSON.parse(str)
    return { data, error: null }
  } catch (e) {
    const msg = e.message
    // Extract line/col from error message (works in V8)
    const pos = extractErrorPosition(str, msg)
    return { data: null, error: { message: msg, ...pos } }
  }
}

function extractErrorPosition(src, msg) {
  // V8: "Unexpected token } in JSON at position N"
  // Modern V8: "Expected ',' or '}' after property value in JSON at line N column M"
  let line = null, column = null

  const lineColMatch = msg.match(/at line (\d+) column (\d+)/)
  if (lineColMatch) {
    line = parseInt(lineColMatch[1])
    column = parseInt(lineColMatch[2])
    return { line, column }
  }

  const posMatch = msg.match(/at position (\d+)/)
  if (posMatch) {
    const pos = parseInt(posMatch[1])
    const before = src.slice(0, pos)
    line = (before.match(/\n/g) || []).length + 1
    column = pos - before.lastIndexOf('\n')
    return { line, column }
  }

  return { line: null, column: null }
}

export function formatJSON(str, indent = 2) {
  const { data, error } = parseJSON(str)
  if (error) return { result: null, error }
  return { result: JSON.stringify(data, null, indent), error: null }
}

export function minifyJSON(str) {
  const { data, error } = parseJSON(str)
  if (error) return { result: null, error }
  return { result: JSON.stringify(data), error: null }
}

export function getStats(str) {
  const { data, error } = parseJSON(str)
  if (error || data === null) return null
  return {
    size: new Blob([str]).size,
    keys: countKeys(data),
    depth: getDepth(data),
  }
}

function countKeys(obj) {
  if (typeof obj !== 'object' || obj === null) return 0
  let count = 0
  if (Array.isArray(obj)) {
    for (const v of obj) count += countKeys(v)
  } else {
    count += Object.keys(obj).length
    for (const v of Object.values(obj)) count += countKeys(v)
  }
  return count
}

function getDepth(obj) {
  if (typeof obj !== 'object' || obj === null) return 0
  const values = Array.isArray(obj) ? obj : Object.values(obj)
  if (values.length === 0) return 1
  return 1 + Math.max(...values.map(getDepth))
}

export function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}
