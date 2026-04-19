/**
 * autoFixJson — repairs malformed JSON through a staged transformation pipeline.
 *
 * Pipeline order (each pass assumes previous passes have already run):
 *
 *  1.  Normalise line endings
 *  2.  Strip comments                        (// and /* … * /)
 *  3.  Close unterminated SINGLE-quoted strings  (at newline — before singleToDouble)
 *  4.  Close unterminated DOUBLE-quoted strings  (at newline — BEFORE fixControlChars)
 *  5.  Fix control chars in double-quoted strings
 *  6.  Convert backtick template literals    (`str` → "str")
 *  7.  Wrap bare function calls              (ObjectId("x") → "ObjectId(\"x\")")
 *  8.  Fix numeric separators               (30_000 → 30000)
 *  9.  Extended literal normalisation        (True/False/None/yes/no/on/off/NaN/Infinity)
 *      NOTE: yes/no/on/off only replaced as VALUES via (?!\s*:) guard
 * 10.  Fix invalid numbers                   (.5→0.5, 1.→1.0, -.5→-0.5, +5→5)
 * 11.  Single → double quotes
 * 12.  Quote unquoted object keys
 * 13.  Insert missing colon
 * 14.  Remove trailing commas
 * 15.  Insert missing commas
 * 16.  Close unclosed brackets/braces
 *
 * Returns: { fixed: string, changes: string[], error: string|null }
 */
export function autoFixJson(input) {
  if (!input || !input.trim()) {
    return { fixed: input, changes: [], error: 'Input is empty' }
  }

  if (isValidJson(input)) {
    return { fixed: input, changes: ['Already valid JSON — no fixes needed'], error: null }
  }

  let src = input
  const changes = []

  function apply(label, fn) {
    const next = fn(src)
    if (next !== src) { changes.push(label); src = next }
  }

  src = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  apply('Removed // and /* */ comments',                                       stripComments)
  apply('Closed unterminated single-quoted strings',                          closeUnterminatedSingleQuotes)
  apply('Fixed control chars + closed unterminated double-quoted strings',    fixControlCharsInStrings)
  apply('Converted backtick template literals to strings',                    convertBackticks)
  apply('Wrapped bare function calls as strings (ObjectId, ISODate, etc.)',   wrapBareFunctionCalls)
  apply('Removed numeric separators (30_000 → 30000)',                        fixNumericSeparators)
  apply('Normalised literals (True/False/None/yes/no/on/off/NaN/Infinity)',   normalizeAllLiterals)
  apply('Fixed non-standard number formats (.5→0.5, 1.→1.0, -.5→-0.5)',     fixNumbers)
  apply('Quoted hyphenated digit sequences (card numbers, SSNs, phone nos.)', fixHyphenatedNumbers)
  apply('Converted single-quoted strings to double quotes',                   singleToDouble)
  apply('Quoted unquoted object keys',                                        quoteUnquotedKeys)
  apply('Inserted missing colons between keys and values',                    insertMissingColons)
  apply('Removed trailing commas',                                            removeTrailingCommas)
  apply('Inserted missing commas between values',                             insertMissingCommas)
  apply('Closed unclosed brackets/braces',                                    closeUnclosed)

  if (isValidJson(src)) {
    if (changes.length === 0) changes.push('No changes needed')
    return { fixed: src, changes, error: null }
  }

  return {
    fixed: src,
    changes,
    error: 'Could not fully repair JSON — some issues require manual correction',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 2 — Strip comments
// ─────────────────────────────────────────────────────────────────────────────

function stripComments(src) {
  let result = '', i = 0
  while (i < src.length) {
    if (src[i] === '"') {
      const { str, end } = readDoubleQuoted(src, i)
      result += str; i = end; continue
    }
    if (src[i] === "'") {
      const { str, end } = readSingleQuoted(src, i)
      result += str; i = end; continue
    }
    // Skip backtick template literals verbatim (convertBackticks runs after this pass)
    if (src[i] === '`') {
      let s = '`'; i++
      while (i < src.length) {
        const c = src[i]; s += c
        if (c === '\\' && i + 1 < src.length) { s += src[i + 1]; i += 2; continue }
        i++; if (c === '`') break
      }
      result += s; continue
    }
    if (src[i] === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      i += 2
      while (i < src.length) {
        if (src[i] === '*' && src[i + 1] === '/') { i += 2; break }
        result += src[i] === '\n' ? '\n' : ' '; i++
      }
      continue
    }
    result += src[i++]
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 3 — Close unterminated SINGLE-quoted strings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Must run BEFORE singleToDouble so that conversion sees clean, closed strings.
 * A single-quoted string crossing a newline is definitively unterminated.
 */
function closeUnterminatedSingleQuotes(src) {
  let result = '', i = 0
  while (i < src.length) {
    if (src[i] === '"') {
      const { str, end } = readDoubleQuoted(src, i)
      result += str; i = end; continue
    }
    if (src[i] === "'") {
      let inner = "'"; i++
      while (i < src.length) {
        const ch = src[i]
        if (ch === '\\') { inner += ch + (src[i + 1] || ''); i += 2; continue }
        if (ch === "'") { inner += ch; i++; break }
        if (ch === '\n') { inner += "'"; break }   // unterminated → close here
        inner += ch; i++
      }
      result += inner; continue
    }
    result += src[i++]
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 4 — Close unterminated DOUBLE-quoted strings (BEFORE fixControlChars)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CRITICAL ORDERING: this runs BEFORE fixControlCharsInStrings.
 * Reason: fixControlChars escapes raw \n → \\n, which hides the terminator signal.
 * By closing first, we preserve the semantics of raw newline = unterminated string.
 */
function closeUnterminatedDoubleQuotes(src) {
  let result = '', i = 0, inString = false
  while (i < src.length) {
    const ch = src[i]
    if (inString) {
      if (ch === '\\') { result += ch; i++; if (i < src.length) { result += src[i]; i++ }; continue }
      if (ch === '"')  { inString = false; result += ch; i++; continue }
      if (ch === '\n') { result += '"'; inString = false; result += ch; i++; continue }
      result += ch; i++; continue
    }
    if (ch === '"') { inString = true; result += ch; i++; continue }
    result += ch; i++
  }
  if (inString) result += '"'
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 5 — Fix raw control characters inside double-quoted strings
// ─────────────────────────────────────────────────────────────────────────────

function fixControlCharsInStrings(src) {
  let result = '', i = 0
  while (i < src.length) {
    if (src[i] !== '"') { result += src[i++]; continue }
    result += '"'; i++
    while (i < src.length) {
      const ch = src[i]
      if (ch === '\\') {
        const next = src[i + 1]
        if (!next) { i++; break }
        const VALID = '"\\\/bfnrtu'
        if (VALID.includes(next)) { result += ch + next; i += 2 }
        else if (next === "'")    { result += "'"; i += 2 }
        else                      { result += next; i += 2 }
        continue
      }
      if (ch === '"') { result += '"'; i++; break }
      if (ch === '\n') {
        // Heuristic: if after this newline (skipping whitespace) the next content
        // looks like JSON structure (new key-value pair, bracket, etc.), then
        // the string is unterminated — close it. Otherwise escape the newline.
        let j = i + 1
        while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++
        const peek = src.slice(j, j + 25)
        const looksStructural = /^"[^"]*"\s*:/.test(peek) ||  // "key": pattern
                                /^[}\]]/.test(peek)          ||  // closing bracket
                                /^[{[]/.test(peek)           ||  // opening bracket
                                /^"/.test(peek)                  // another string value starts
        if (looksStructural) { result += '"'; i++; break }     // close string here
        else                 { result += '\\n'; i++; continue } // escape it
      }
      if (ch === '\r') { result += '\\r';  i++; continue }
      if (ch === '\t') { result += '\\t';  i++; continue }
      if (ch === '\b') { result += '\\b';  i++; continue }
      if (ch === '\f') { result += '\\f';  i++; continue }
      const code = ch.charCodeAt(0)
      if (code < 0x20) { result += '\\u' + code.toString(16).padStart(4, '0'); i++; continue }
      result += ch; i++
    }
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 6 — Convert backtick template literals → double-quoted strings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * JavaScript template literals like `Bearer ${token}` are not valid JSON.
 * Convert them to double-quoted strings, keeping template expressions as
 * literal text (best-effort — we can't evaluate them).
 */
function convertBackticks(src) {
  let result = '', i = 0
  while (i < src.length) {
    if (src[i] === '"') {
      const { str, end } = readDoubleQuoted(src, i)
      result += str; i = end; continue
    }
    if (src[i] === "'") {
      const { str, end } = readSingleQuoted(src, i)
      result += str; i = end; continue
    }
    if (src[i] === '`') {
      let inner = ''; i++
      while (i < src.length) {
        const c = src[i]
        if (c === '\\' && src[i + 1] === '`') { inner += '`'; i += 2; continue }
        if (c === '`') { i++; break }
        if (c === '"')  { inner += '\\"'; i++; continue }
        if (c === '\n') { inner += '\\n'; i++; continue }
        if (c === '\r') { inner += '\\r'; i++; continue }
        if (c === '\t') { inner += '\\t'; i++; continue }
        inner += c; i++
      }
      result += '"' + inner + '"'; continue
    }
    result += src[i++]
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 7 — Wrap bare function calls as strings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MongoDB-style constructors and similar bare function calls are not valid JSON:
 *   ObjectId("507f...") → "ObjectId(\"507f...\")"
 *   ISODate("2023-01-15") → "ISODate(\"2023-01-15\")"
 *
 * Strategy: scan for UPPERCASE-starting IDENTIFIER( pattern outside strings.
 * Only uppercase first letter to avoid false-positives on lowercase keywords.
 */
function wrapBareFunctionCalls(src) {
  let result = '', i = 0
  while (i < src.length) {
    if (src[i] === '"') {
      const { str, end } = readDoubleQuoted(src, i)
      result += str; i = end; continue
    }
    // Uppercase letter could start a function call identifier
    if (/[A-Z]/.test(src[i])) {
      let ident = '', j = i
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) { ident += src[j++] }
      if (src[j] === '(' && ident.length > 1) {
        // Scan to matching closing paren
        let call = ident + '('; j++; let depth = 1
        while (j < src.length && depth > 0) {
          const c = src[j]
          if (c === '"') {
            const { str: qs, end: qe } = readDoubleQuoted(src, j)
            call += qs; j = qe; continue
          }
          if (c === "'") {
            const { str: ss, end: se } = readSingleQuoted(src, j)
            call += ss; j = se; continue
          }
          if (c === '(') depth++
          if (c === ')') { depth--; if (depth === 0) { call += c; j++; break } }
          call += c; j++
        }
        const escaped = call.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        result += '"' + escaped + '"'; i = j; continue
      }
      result += ident; i = j; continue
    }
    result += src[i++]
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 8 — Fix numeric separators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * JavaScript allows underscores in numeric literals (30_000, 1_000_000).
 * JSON does not. Strip them.
 */
function fixNumericSeparators(src) {
  return transformOutsideStrings(src, chunk => {
    // Loop until stable — handles multi-underscore literals like 1_000_000
    let prev = chunk
    while (true) {
      const next = prev.replace(/(\d+)_(\d+)/g, '$1$2')
      if (next === prev) break
      prev = next
    }
    return prev
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 9 — Extended literal normalisation
// ─────────────────────────────────────────────────────────────────────────────

function normalizeAllLiterals(src) {
  return transformOutsideStrings(src, chunk =>
    chunk
      .replace(/\bTrue\b/g,  'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/\bNone\b/g,  'null')
      .replace(/\bundefined\b/g, 'null')
      // yes/no/on/off: guard with (?!\s*:) to skip keys, and (?<![-\w]) to skip
      // hyphenated identifiers like "runs-on", "feature-off", "depends_on"
      .replace(/(?<![-\w])\byes\b(?!\s*:)/gi,  'true')
      .replace(/(?<![-\w])\bno\b(?!\s*:)/gi,   'false')
      .replace(/(?<![-\w])\bon\b(?!\s*:)/gi,   'true')
      .replace(/(?<![-\w])\boff\b(?!\s*:)/gi,  'false')
      .replace(/(?<![.\d])-Infinity\b/g, 'null')
      .replace(/\bInfinity\b/g,          'null')
      .replace(/\bNaN\b/g,               'null')
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 10 — Fix invalid number formats
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles:
 *   .5   → 0.5   (leading decimal)
 *   -.5  → -0.5  (negative leading decimal — "-" added to delimiter set)
 *   1.   → 1.0   (trailing decimal)
 *   +5   → 5     (leading plus)
 */
function fixNumbers(src) {
  return transformOutsideStrings(src, chunk =>
    chunk
      .replace(/(^|[\s,:\[{(-])\.(\d)/g, (_, b, d) => `${b}0.${d}`)
      .replace(/(\d+\.)(?!\d)/g, '$10')
      .replace(/(^|[\s,:\[{(])\+(\d)/g, '$1$2')
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 10b — Quote hyphenated digit sequences (card numbers, SSNs, phone nos.)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bare hyphenated digit sequences are not valid JSON but are extremely common
 * in real data: credit card numbers, SSNs, phone numbers, IDs.
 *
 *   "cardNumber": 1234-5678-9012-3456  →  "cardNumber": "1234-5678-9012-3456"
 *   "ssn": 123-45-6789                →  "ssn": "123-45-6789"
 *
 * Guard: only matches at value positions (after :  ,  [  or whitespace).
 * Never touches negative numbers like -5 (single leading dash, not digits-dash-digits).
 * Never modifies content inside strings (transformOutsideStrings guarantees this).
 */
function fixHyphenatedNumbers(src) {
  return transformOutsideStrings(src, chunk =>
    chunk.replace(
      /([:,\[\s])(\d+(?:-\d+)+)(?=[\s,\]}\n]|$)/g,
      (_, before, val) => `${before}"${val}"`
    )
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 11 — Single → double quotes
// ─────────────────────────────────────────────────────────────────────────────

function singleToDouble(src) {
  let result = '', i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '"') {
      const { str, end } = readDoubleQuoted(src, i)
      result += str; i = end; continue
    }
    if (ch === "'") {
      let inner = ''; i++
      while (i < src.length) {
        const c = src[i]
        if (c === '\\' && src[i + 1] === "'") { inner += "'"; i += 2 }
        else if (c === '"')  { inner += '\\"'; i++ }
        else if (c === "'")  { i++; break }
        else                 { inner += c; i++ }
      }
      result += '"' + inner + '"'; continue
    }
    result += ch; i++
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 12 — Quote unquoted object keys
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Matches keys after {, after ,, and after newlines (for comma-free objects).
 * Anchor: /((?:^|[{,\n])\s*)/  — the key preceding context.
 */
function quoteUnquotedKeys(src) {
  return transformOutsideStrings(src, chunk =>
    chunk.replace(
      /((?:^|[{,\n])\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g,
      (_, before, key, colon) => `${before}"${key}"${colon}`
    )
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 13 — Insert missing colon (key-position strings only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tracks lastToken to distinguish key-position strings from value-position strings.
 * Colon is only injected when the string was just preceded by { or , (key position).
 * This prevents "Alice" in {"name":"Alice" "age":30} from getting a spurious colon.
 */
function insertMissingColons(src) {
  let result = '', i = 0
  const ctx = []
  let lastToken = null
  const isObject = () => ctx.length > 0 && ctx[ctx.length - 1] === '{'
  const inKeyPos = () => isObject() && (lastToken === 'open_brace' || lastToken === 'comma' || lastToken === null)

  while (i < src.length) {
    const ch = src[i]
    if (ch === '{') { ctx.push('{'); result += ch; i++; lastToken = 'open_brace'; continue }
    if (ch === '[') { ctx.push('['); result += ch; i++; lastToken = 'open_bracket'; continue }
    if (ch === '}') { if (ctx.length) ctx.pop(); result += ch; i++; lastToken = 'value'; continue }
    if (ch === ']') { if (ctx.length) ctx.pop(); result += ch; i++; lastToken = 'value'; continue }
    if (ch === ':') { result += ch; i++; lastToken = 'colon'; continue }
    if (ch === ',') { result += ch; i++; lastToken = 'comma'; continue }

    if (ch === '"') {
      const { str, end } = readDoubleQuoted(src, i)
      result += str; i = end

      if (inKeyPos()) {
        let j = i
        while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++
        const next = src[j]
        const notSep = next !== undefined && next !== ':' && next !== ',' &&
                       next !== '}' && next !== ']' && next !== '\n' && next !== '\r'
        if (notSep && /^["{\[0-9\-]|^true\b|^false\b|^null\b/.test(src.slice(j))) {
          result += ':'
          lastToken = 'colon'
        } else { lastToken = 'value' }
      } else { lastToken = 'value' }
      continue
    }

    if (/[\d\-]/.test(ch) || src.startsWith('true', i) || src.startsWith('false', i) || src.startsWith('null', i)) {
      lastToken = 'value'
    }
    result += ch; i++
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 14 — Remove trailing commas
// ─────────────────────────────────────────────────────────────────────────────

function removeTrailingCommas(src) {
  return transformOutsideStrings(src, chunk =>
    chunk.replace(/,(\s*[}\]])/g, '$1')
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 15 — Insert missing commas (whitespace gaps + direct adjacency)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Two sub-passes:
 *
 * A) Whitespace-separated: char-by-char scanner with afterValue state.
 *    Handles newlines and spaces between values.
 *    Sees closing quotes directly (not blocked by transformOutsideStrings).
 *
 * B) Direct adjacency: ][  ][  }{  }{ with zero whitespace between them.
 *    Handled by a regex pass on non-string chunks.
 */
function insertMissingCommas(src) {
  function startsKeyword(s, pos, kw) {
    return s.startsWith(kw, pos) && !/\w/.test(s[pos + kw.length] || '')
  }

  /**
   * Single unified pass combining:
   *  - Whitespace-gap detection (preserves spacing)
   *  - Zero-whitespace direct adjacency (strings, numbers, brackets)
   *
   * Uses `lastWasWS` flag: when true, the whitespace handler already
   * inserted a comma if needed — so don't double-insert at the token boundary.
   */
  function onePass(s) {
    let result = '', i = 0, av = false, lastWasWS = false

    function insertIfNeeded() {
      if (av && !lastWasWS) { result += ','; av = false }
    }

    while (i < s.length) {
      const ch = s[i]

      if (ch === '"') {
        insertIfNeeded()
        const { str, end } = readDoubleQuoted(s, i)
        result += str; i = end; av = true; lastWasWS = false; continue
      }
      if (ch === ':') { result += ch; i++; av = false; lastWasWS = false; continue }
      if (ch === ',') { result += ch; i++; av = false; lastWasWS = false; continue }
      if (ch === '{') { insertIfNeeded(); result += ch; i++; av = false; lastWasWS = false; continue }
      if (ch === '[') { insertIfNeeded(); result += ch; i++; av = false; lastWasWS = false; continue }
      if (ch === '}' || ch === ']') { result += ch; i++; av = true; lastWasWS = false; continue }

      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        let ws = ''
        while (i < s.length && /[ \t\n\r]/.test(s[i])) { ws += s[i++] }
        if (av) {
          const rest = s[i]
          const isValueStart = rest === '"' || rest === '{' || rest === '[' || rest === '-' ||
            /\d/.test(rest) ||
            startsKeyword(s, i, 'true') || startsKeyword(s, i, 'false') || startsKeyword(s, i, 'null')
          if (isValueStart) { result += ',' + ws; av = false; lastWasWS = false }
          else              { result += ws; lastWasWS = true }
        } else { result += ws; lastWasWS = true }
        continue
      }

      if (/\d/.test(ch) || (ch === '-' && /\d/.test(s[i + 1] || ''))) {
        insertIfNeeded()
        let num = ''
        while (i < s.length && /[\d.eE+\-]/.test(s[i])) { num += s[i++] }
        result += num; av = true; lastWasWS = false; continue
      }
      if (startsKeyword(s, i, 'true'))  { insertIfNeeded(); result += 'true';  i += 4; av = true; lastWasWS = false; continue }
      if (startsKeyword(s, i, 'false')) { insertIfNeeded(); result += 'false'; i += 5; av = true; lastWasWS = false; continue }
      if (startsKeyword(s, i, 'null'))  { insertIfNeeded(); result += 'null';  i += 4; av = true; lastWasWS = false; continue }

      result += ch; i++; av = false; lastWasWS = false
    }
    return result
  }

  let prev = src
  for (let k = 0; k < 20; k++) {
    const next = onePass(prev)
    if (next === prev) break
    prev = next
  }
  return prev
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 16 — Close unclosed brackets/braces (positional recovery)
// ─────────────────────────────────────────────────────────────────────────────

const RECOVERY_LOOKAHEAD = 40

function closeUnclosed(src) {
  const stack = []
  let inStr = false, i = 0
  while (i < src.length) {
    const ch = src[i]
    if (inStr) {
      if (ch === '\\') { i += 2; continue }
      if (ch === '"')  inStr = false
      i++; continue
    }
    if (ch === '"')  { inStr = true; i++; continue }
    if (ch === '{')  { stack.push('}'); i++; continue }
    if (ch === '[')  { stack.push(']'); i++; continue }
    if (ch === '}' || ch === ']') {
      if (stack.length === 0) { src = src.slice(0, i) + src.slice(i + 1); continue }
      const expected = stack[stack.length - 1]
      if (ch === expected) { stack.pop(); i++; continue }
      const lookahead = src.slice(i + 1, i + 1 + RECOVERY_LOOKAHEAD)
      if (lookahead.includes(expected)) {
        src = src.slice(0, i) + src.slice(i + 1)  // spurious closer — remove, re-examine
      } else {
        src = src.slice(0, i) + expected + src.slice(i)  // insert correct closer
        stack.pop()
        i++  // advance past inserted closer to prevent insert/remove loop
      }
      continue
    }
    i++
  }
  return src + stack.map(s => s).reverse().join('')
}

// ─────────────────────────────────────────────────────────────────────────────
// Low-level tokenizer helpers
// ─────────────────────────────────────────────────────────────────────────────

export function isValidJson(str) {
  try { JSON.parse(str); return true } catch { return false }
}

function transformOutsideStrings(src, transform) {
  let result = '', i = 0, chunk = ''
  while (i < src.length) {
    if (src[i] === '"') {
      result += transform(chunk); chunk = ''
      const { str, end } = readDoubleQuoted(src, i)
      result += str; i = end
    } else { chunk += src[i++] }
  }
  return result + transform(chunk)
}

function readDoubleQuoted(src, start) {
  let i = start + 1, str = '"'
  while (i < src.length) {
    const ch = src[i]; str += ch
    if (ch === '\\') { if (i + 1 < src.length) { str += src[i + 1]; i += 2; continue } }
    i++; if (ch === '"') break
  }
  return { str, end: i }
}

function readSingleQuoted(src, start) {
  let i = start + 1, str = "'"
  while (i < src.length) {
    const ch = src[i]; str += ch
    if (ch === '\\') { if (i + 1 < src.length) { str += src[i + 1]; i += 2; continue } }
    i++; if (ch === "'") break
  }
  return { str, end: i }
}