/**
 * autoFixJson — attempts to repair common JSON authoring mistakes.
 *
 * Strategy: apply transformations in a safe, ordered pipeline and
 * validate after each step so we never corrupt already-valid JSON.
 *
 * Returns: { fixed: string, changes: string[], error: string|null }
 */
export function autoFixJson(input) {
  if (!input || !input.trim()) {
    return { fixed: input, changes: [], error: 'Input is empty' }
  }

  // Already valid — nothing to do
  if (isValidJson(input)) {
    return { fixed: input, changes: ['Already valid JSON — no fixes needed'], error: null }
  }

  let src = input
  const changes = []

  // ── Pass 1: Normalise line endings ──────────────────────────────
  src = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // ── Pass 2: Python / Ruby literals ──────────────────────────────
  // True/False/None must be outside strings; we use a tokeniser approach
  const normalized = normalizeLiterals(src)
  if (normalized !== src) {
    changes.push('Converted Python/Ruby literals (True→true, False→false, None→null)')
    src = normalized
  }

  // ── Pass 3: Single-quoted strings → double-quoted ───────────────
  const dquoted = singleToDouble(src)
  if (dquoted !== src) {
    changes.push("Converted single-quoted strings to double quotes")
    src = dquoted
  }

  // ── Pass 4: Unquoted object keys → quoted ───────────────────────
  const keyFixed = quoteUnquotedKeys(src)
  if (keyFixed !== src) {
    changes.push('Quoted unquoted object keys')
    src = keyFixed
  }

  // ── Pass 5: Trailing commas before } or ] ───────────────────────
  const noTrailing = removeTrailingCommas(src)
  if (noTrailing !== src) {
    changes.push('Removed trailing commas')
    src = noTrailing
  }

  // ── Pass 6: Missing commas between values ───────────────────────
  const commaFixed = insertMissingCommas(src)
  if (commaFixed !== src) {
    changes.push('Inserted missing commas between values')
    src = commaFixed
  }

  // ── Pass 7: Unclosed brackets / braces ──────────────────────────
  const closed = closeUnclosed(src)
  if (closed !== src) {
    changes.push('Closed unclosed brackets/braces')
    src = closed
  }

  if (isValidJson(src)) {
    if (changes.length === 0) changes.push('Minor whitespace normalisation')
    return { fixed: src, changes, error: null }
  }

  // Still broken — return partial fixes + honest error message
  return {
    fixed: src,
    changes,
    error: 'Could not fully repair JSON — some issues require manual correction',
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isValidJson(str) {
  try { JSON.parse(str); return true } catch { return false }
}

/**
 * Replace True/False/None that appear as JSON values (not inside strings).
 * We walk char-by-char tracking string context to avoid clobbering content.
 */
function normalizeLiterals(src) {
  // Replace out-of-string occurrences only via tokenizer
  return transformOutsideStrings(src, (chunk) =>
    chunk
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/\bNone\b/g, 'null')
      .replace(/\bundefined\b/g, 'null')
  )
}

/**
 * Convert single-quoted strings to double-quoted.
 * Handles escaped single quotes inside single-quoted strings.
 */
function singleToDouble(src) {
  let result = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]

    // Skip double-quoted strings verbatim
    if (ch === '"') {
      const { str, end } = readDoubleQuoted(src, i)
      result += str
      i = end
      continue
    }

    // Convert single-quoted string
    if (ch === "'") {
      let inner = ''
      i++ // skip opening quote
      while (i < src.length) {
        const c = src[i]
        if (c === '\\' && src[i + 1] === "'") {
          inner += "'"    // unescape \' → '
          i += 2
        } else if (c === '"') {
          inner += '\\"'  // escape bare double-quote
          i++
        } else if (c === "'") {
          i++             // closing quote
          break
        } else {
          inner += c
          i++
        }
      }
      result += '"' + inner + '"'
      continue
    }

    result += ch
    i++
  }
  return result
}

/**
 * Quote unquoted keys: { foo: "bar" } → { "foo": "bar" }
 * Only keys (identifiers before a colon) at the object level.
 */
function quoteUnquotedKeys(src) {
  // Match: (start of object context) identifier followed by optional spaces and colon
  // We use regex on segments outside strings
  return transformOutsideStrings(src, (chunk) =>
    chunk.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, (_, before, key, colon) => {
      // Don't re-quote if already quoted (won't match — quotes consumed by tokenizer)
      return `${before}"${key}"${colon}`
    })
  )
}

function removeTrailingCommas(src) {
  // Remove comma immediately before } or ] (allowing whitespace/newlines between)
  return transformOutsideStrings(src, (chunk) =>
    chunk.replace(/,(\s*[}\]])/g, '$1')
  )
}

/**
 * Insert commas between adjacent values where the comma was omitted.
 * Targets: `value<newline>value` where value ends a JSON token.
 */
function insertMissingCommas(src) {
  // Between a closing token and an opening token with only whitespace
  // closing tokens: " } ] digits true false null
  // opening tokens: " { [ digits - t f n
  return transformOutsideStrings(src, (chunk) =>
    chunk.replace(
      /(["}\]0-9]|true|false|null)(\s*\n\s*)([\[{"\-0-9tfn])/g,
      (_, end, ws, start) => `${end},${ws}${start}`
    )
  )
}

/**
 * Close unclosed brackets by counting and appending the missing closers.
 */
function closeUnclosed(src) {
  const stack = []
  let inStr = false
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (inStr) {
      if (ch === '\\') { i += 2; continue }
      if (ch === '"') inStr = false
    } else {
      if (ch === '"') inStr = true
      else if (ch === '{') stack.push('}')
      else if (ch === '[') stack.push(']')
      else if (ch === '}' || ch === ']') {
        if (stack.length && stack[stack.length - 1] === ch) stack.pop()
      }
    }
    i++
  }
  return src + stack.reverse().join('')
}

// ── Low-level tokenizer helpers ─────────────────────────────────────────────

/**
 * Apply `transform` only to portions of `src` that are NOT inside double-quoted strings.
 */
function transformOutsideStrings(src, transform) {
  let result = ''
  let i = 0
  let chunk = ''

  while (i < src.length) {
    const ch = src[i]
    if (ch === '"') {
      // Flush accumulated non-string chunk
      result += transform(chunk)
      chunk = ''
      // Copy the string verbatim
      const { str, end } = readDoubleQuoted(src, i)
      result += str
      i = end
    } else {
      chunk += ch
      i++
    }
  }
  result += transform(chunk)
  return result
}

/**
 * Read a double-quoted string (handling escapes) starting at index `start`.
 * Returns { str: the raw substring including quotes, end: next index }
 */
function readDoubleQuoted(src, start) {
  let i = start + 1 // skip opening "
  let str = '"'
  while (i < src.length) {
    const ch = src[i]
    str += ch
    if (ch === '\\') {
      // consume escape sequence
      if (i + 1 < src.length) { str += src[i + 1]; i += 2; continue }
    }
    i++
    if (ch === '"') break
  }
  return { str, end: i }
}
