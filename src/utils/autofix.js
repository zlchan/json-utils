/**
 * autoFixJson — repairs malformed JSON through a staged transformation pipeline.
 *
 * Pipeline order (each pass assumes previous passes already ran):
 *
 *  1.  Normalise line endings          (CRLF → LF)
 *  2.  Strip comments                  (// and /* … * /)
 *  3.  Fix control chars in strings    (raw \n \t → escaped; invalid escapes)
 *  4.  Close unterminated strings      (missing closing quote)
 *  5.  Extended literal normalisation  (True/False/None/yes/no/on/off/NaN/Infinity)
 *  6.  Fix invalid numbers             (.5 → 0.5  |  1. → 1.0  |  +5 → 5)
 *  7.  Single → double quotes
 *  8.  Quote unquoted object keys
 *  9.  Insert missing colon            ("key" "value" → "key": "value")
 * 10.  Remove trailing commas
 * 11.  Insert missing commas           (newline-separated AND inline same-line)
 * 12.  Close unclosed brackets/braces  (positional recovery)
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

  apply('Removed // and /* */ comments',                               stripComments)
  apply('Escaped raw control characters inside strings',               fixControlCharsInStrings)
  apply('Closed unterminated string literals',                         closeUnterminatedStrings)
  apply('Normalised literals (True/False/None/yes/no/on/off/NaN/Infinity)', normalizeAllLiterals)
  apply('Fixed non-standard number formats (.5→0.5, 1.→1.0)',         fixNumbers)
  apply('Converted single-quoted strings to double quotes',            singleToDouble)
  apply('Quoted unquoted object keys',                                 quoteUnquotedKeys)
  apply('Inserted missing colons between keys and values',             insertMissingColons)
  apply('Removed trailing commas',                                     removeTrailingCommas)
  apply('Inserted missing commas between values',                      insertMissingCommas)
  apply('Closed unclosed brackets/braces',                             closeUnclosed)

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
    // Double-quoted string — copy verbatim
    if (src[i] === '"') {
      const { str, end } = readDoubleQuoted(src, i)
      result += str; i = end; continue
    }
    // Single-quoted string — copy verbatim (will be converted in pass 7)
    if (src[i] === "'") {
      const { str, end } = readSingleQuoted(src, i)
      result += str; i = end; continue
    }
    // // line comment — skip to end of line (keep the newline)
    if (src[i] === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    // /* block comment — replace with whitespace, preserve newlines
    if (src[i] === '/' && src[i + 1] === '*') {
      i += 2
      while (i < src.length) {
        if (src[i] === '*' && src[i + 1] === '/') { i += 2; break }
        result += src[i] === '\n' ? '\n' : ' '
        i++
      }
      continue
    }
    result += src[i++]
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 3 — Fix raw control characters and invalid escape sequences in strings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scans every double-quoted string and:
 *  - Replaces raw \n \r \t \b \f with their JSON escape equivalents
 *  - Replaces other raw control chars (U+0000–U+001F) with \uXXXX
 *  - For backslash-escape sequences: if the escape char is not one of the
 *    valid JSON escape chars, keep the literal character (drop the backslash).
 *    Exception: \\ is always kept, \' → ' (single-quote unescape is harmless).
 *
 * Does NOT touch content outside strings.
 */
function fixControlCharsInStrings(src) {
  let result = '', i = 0

  while (i < src.length) {
    if (src[i] !== '"') { result += src[i++]; continue }

    result += '"'
    i++ // skip opening quote

    while (i < src.length) {
      const ch = src[i]

      if (ch === '\\') {
        const next = src[i + 1]
        if (next === undefined) { i++; break } // trailing backslash — drop
        // Valid JSON escape sequences
        const VALID = '"\\\/bfnrtu'
        if (VALID.includes(next)) {
          result += ch + next; i += 2
        } else if (next === "'") {
          result += "'"; i += 2  // \' → ' (harmless unescape)
        } else {
          // Invalid escape like \p, \a, \w — drop the backslash, keep char
          result += next; i += 2
        }
        continue
      }

      if (ch === '"') { result += '"'; i++; break }

      // Raw control characters that JSON strings must not contain
      if (ch === '\n') { result += '\\n';  i++; continue }
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
// Pass 4 — Close unterminated strings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * If a string is opened but never closed, insert the closing quote.
 * Heuristic: a raw newline inside a string means it was probably not
 * intentional — close the string before the newline so the rest of the
 * document can still parse.  If we reach EOF while in a string, close there.
 *
 * NOTE: pass 3 already escapes intentional raw newlines in strings, so by
 * the time this pass runs the only remaining raw newlines inside strings
 * are the ones that indicate an unterminated string.
 */
function closeUnterminatedStrings(src) {
  let result = '', i = 0, inString = false

  while (i < src.length) {
    const ch = src[i]

    if (inString) {
      if (ch === '\\') {
        result += ch; i++
        if (i < src.length) { result += src[i]; i++ }
        continue
      }
      if (ch === '"') { inString = false; result += ch; i++; continue }
      if (ch === '\n') {
        // Unterminated — close before newline
        result += '"'; inString = false
        result += ch; i++; continue
      }
      result += ch; i++; continue
    }

    if (ch === '"') { inString = true; result += ch; i++; continue }
    result += ch; i++
  }

  if (inString) result += '"' // EOF while open
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 5 — Extended literal normalisation
// ─────────────────────────────────────────────────────────────────────────────

function normalizeAllLiterals(src) {
  return transformOutsideStrings(src, chunk =>
    chunk
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/\bNone\b/g, 'null')
      .replace(/\bundefined\b/g, 'null')
      .replace(/\byes\b/gi, 'true')
      .replace(/\bno\b/gi, 'false')
      .replace(/\bon\b/gi, 'true')
      .replace(/\boff\b/gi, 'false')
      // NaN and Infinity must come before number fixes and must handle the
      // optional leading minus sign as part of the same token.
      // Use a negative lookbehind for digits to avoid hitting e.g. "BigNaN"
      .replace(/(?<![.\d])-Infinity\b/g, 'null')
      .replace(/\bInfinity\b/g, 'null')
      .replace(/\bNaN\b/g, 'null')
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 6 — Invalid number formats
// ─────────────────────────────────────────────────────────────────────────────

/**
 *  .5   → 0.5   (missing leading zero)
 *  1.   → 1.0   (missing fractional digit)
 *  +5   → 5     (leading + sign is not valid JSON)
 *
 * All replacements are made only outside of strings.
 * We guard against partial hits by requiring the decimal point to be
 * preceded by a non-alphanumeric delimiter.
 */
function fixNumbers(src) {
  return transformOutsideStrings(src, chunk =>
    chunk
      // .5 → 0.5  — decimal point at start of number token
      .replace(/(^|[\s,:\[{(])\.(\d)/g, (_, before, digit) => `${before}0.${digit}`)
      // 1. → 1.0  — decimal point at end of number token (not followed by digit)
      .replace(/(\d+\.)(?!\d)/g, '$10')
      // +5 → 5    — leading plus
      .replace(/(^|[\s,:\[{(])\+(\d)/g, '$1$2')
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 7 — Single → double quotes
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
// Pass 8 — Quote unquoted object keys
// ─────────────────────────────────────────────────────────────────────────────

function quoteUnquotedKeys(src) {
  return transformOutsideStrings(src, chunk =>
    chunk.replace(
      /([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g,
      (_, before, key, colon) => `${before}"${key}"${colon}`
    )
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 9 — Insert missing colon between key and value
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fixes: { "name" "John" } → { "name": "John" }
 *        { "count" 42 }    → { "count": 42 }
 *
 * We track the depth/context of the parse so we only insert colons when
 * we are directly inside an OBJECT (not inside an array or nested value).
 * This prevents turning ["a" "b"] into ["a": "b"].
 *
 * Context tracking:
 *   - Push '{' when we see {, pop on }
 *   - Push '[' when we see [, pop on ]
 *   - isObject() = top of context stack is '{'
 *   - A string that appears inside an object and is immediately followed by
 *     whitespace + a value-start (not :) → inject colon.
 */
function insertMissingColons(src) {
  let result = ''
  let i = 0
  const ctx = []  // stack of '{' or '['

  function isObject() { return ctx.length > 0 && ctx[ctx.length - 1] === '{' }

  while (i < src.length) {
    const ch = src[i]

    if (ch === '{') { ctx.push('{'); result += ch; i++; continue }
    if (ch === '[') { ctx.push('['); result += ch; i++; continue }
    if (ch === '}') { if (ctx.length) ctx.pop(); result += ch; i++; continue }
    if (ch === ']') { if (ctx.length) ctx.pop(); result += ch; i++; continue }

    if (ch === '"') {
      const { str, end } = readDoubleQuoted(src, i)
      result += str; i = end

      // Only consider colon injection when we're inside an object
      if (isObject()) {
        let j = i
        while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++

        const nextCh = src[j]
        const notColon = nextCh !== undefined && nextCh !== ':' &&
                         nextCh !== ',' && nextCh !== '}' && nextCh !== ']' &&
                         nextCh !== '\n' && nextCh !== '\r'

        if (notColon && /^["{\[0-9\-]|^true\b|^false\b|^null\b/.test(src.slice(j))) {
          result += ':'
        }
      }
      continue
    }

    result += ch; i++
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 10 — Remove trailing commas
// ─────────────────────────────────────────────────────────────────────────────

function removeTrailingCommas(src) {
  return transformOutsideStrings(src, chunk =>
    chunk.replace(/,(\s*[}\]])/g, '$1')
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 11 — Insert missing commas (newline-separated AND inline same-line)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scans the source char-by-char, tracking when we are "after a value" and
 * "before a value". When only whitespace (including newlines) sits between
 * two consecutive values with no comma, inserts one.
 *
 * "After a value" is true after:
 *   - the closing " of a string
 *   - the closing } or ] of an object/array
 *   - the last digit of a number
 *   - the last char of true / false / null
 *
 * "Before a value" is true before:
 *   - opening " of a string
 *   - opening { or [ of an object/array
 *   - a digit or - starting a number
 *   - t / f / n starting true/false/null
 *
 * Comma is NOT inserted:
 *   - before : (key→value separator)
 *   - before , (already there)
 *   - before } or ] (trailing comma — handled by pass 10)
 *   - inside strings (we track string depth)
 */
function insertMissingCommas(src) {
  // Build the output in one pass (iterate to fixpoint for chains like [1 2 3])
  function onePass(s) {
    let result = ''
    let i = 0
    let afterValue = false   // true when the last meaningful token was a value-end

    // Helpers
    function startsKeyword(pos, kw) {
      return s.startsWith(kw, pos) && !/\w/.test(s[pos + kw.length] || '')
    }

    while (i < s.length) {
      const ch = s[i]

      // ── Inside a string ──────────────────────────────────────────────────
      if (ch === '"') {
        const { str, end } = readDoubleQuoted(s, i)
        result += str
        i = end
        afterValue = true   // closing quote = end of a string value
        continue
      }

      // ── Structural: after-value punctuation ──────────────────────────────
      if (ch === ':') { result += ch; i++; afterValue = false; continue }
      if (ch === ',') { result += ch; i++; afterValue = false; continue }
      if (ch === '{' || ch === '[') { result += ch; i++; afterValue = false; continue }
      if (ch === '}' || ch === ']') { result += ch; i++; afterValue = true;  continue }

      // ── Whitespace (potential comma injection point) ──────────────────────
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        // Collect all whitespace
        let ws = ''
        while (i < s.length && /[ \t\n\r]/.test(s[i])) { ws += s[i++] }

        if (afterValue) {
          // Peek: is the next non-space char a value-start?
          const rest = s[i]
          const isValueStart =
            rest === '"' || rest === '{' || rest === '[' || rest === '-' ||
            /\d/.test(rest) ||
            startsKeyword(i, 'true') || startsKeyword(i, 'false') || startsKeyword(i, 'null')

          // Also exclude colon, comma, ], } — not a value start
          if (isValueStart) {
            result += ',' + ws   // inject comma before the whitespace
            afterValue = false
          } else {
            result += ws
          }
        } else {
          result += ws
        }
        continue
      }

      // ── Number literal ────────────────────────────────────────────────────
      if (/\d/.test(ch) || (ch === '-' && /\d/.test(s[i + 1] || ''))) {
        let num = ''
        while (i < s.length && /[\d.eE+\-]/.test(s[i])) { num += s[i++] }
        result += num
        afterValue = true
        continue
      }

      // ── Keywords: true / false / null ─────────────────────────────────────
      if (startsKeyword(i, 'true'))  { result += 'true';  i += 4; afterValue = true;  continue }
      if (startsKeyword(i, 'false')) { result += 'false'; i += 5; afterValue = true;  continue }
      if (startsKeyword(i, 'null'))  { result += 'null';  i += 4; afterValue = true;  continue }

      // ── Everything else ───────────────────────────────────────────────────
      result += ch; i++
      afterValue = false
    }
    return result
  }

  // Iterate to fixpoint (handles chains like [1 2 3 4])
  let prev = src
  for (let k = 0; k < 20; k++) {
    const next = onePass(prev)
    if (next === prev) break
    prev = next
  }
  return prev
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 12 — Close unclosed brackets/braces (positional recovery)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Improved strategy:
 *  1. Walk the source maintaining a stack of openers.
 *  2. On a closer that doesn't match the stack top:
 *     a. If the correct closer appears within LOOKAHEAD chars → this is a
 *        spurious/extra closer; remove it and re-examine.
 *     b. Otherwise insert the correct closer at this position, pop the stack,
 *        and re-examine (don't advance) so the original char is now checked again.
 *  3. On a closer with an empty stack (orphan closer) → remove it.
 *  4. Append any remaining unclosed openers in reverse order at EOF.
 */
const RECOVERY_LOOKAHEAD = 40

function closeUnclosed(src) {
  const stack = []  // { closer: '}' | ']' }
  let inStr = false, i = 0

  while (i < src.length) {
    const ch = src[i]

    if (inStr) {
      if (ch === '\\') { i += 2; continue }
      if (ch === '"')  inStr = false
      i++; continue
    }

    if (ch === '"')  { inStr = true; i++; continue }

    if (ch === '{') { stack.push('}'); i++; continue }
    if (ch === '[') { stack.push(']'); i++; continue }

    if (ch === '}' || ch === ']') {
      if (stack.length === 0) {
        // Orphan closer — remove
        src = src.slice(0, i) + src.slice(i + 1)
        // Don't advance i
        continue
      }
      const expected = stack[stack.length - 1]
      if (ch === expected) {
        stack.pop(); i++; continue
      }
      // Mismatch
      const lookahead = src.slice(i + 1, i + 1 + RECOVERY_LOOKAHEAD)
      if (lookahead.includes(expected)) {
        // The correct closer appears soon → this one is spurious, remove it
        src = src.slice(0, i) + src.slice(i + 1)
        // Don't advance
      } else {
        // Insert the correct closer before the current char
        src = src.slice(0, i) + expected + src.slice(i)
        stack.pop()
        // Don't advance — re-examine position i (now the inserted closer)
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

/**
 * Apply `transform` only to the portions of `src` that are NOT inside
 * double-quoted strings. Single-quoted strings are included in the
 * non-string chunks — they are handled by pass 7.
 */
function transformOutsideStrings(src, transform) {
  let result = '', i = 0, chunk = ''
  while (i < src.length) {
    if (src[i] === '"') {
      result += transform(chunk); chunk = ''
      const { str, end } = readDoubleQuoted(src, i)
      result += str; i = end
    } else {
      chunk += src[i++]
    }
  }
  return result + transform(chunk)
}

/**
 * Read a double-quoted string (with escape handling).
 * Returns { str: raw text including quotes, end: index after closing quote }
 */
function readDoubleQuoted(src, start) {
  let i = start + 1, str = '"'
  while (i < src.length) {
    const ch = src[i]; str += ch
    if (ch === '\\') { if (i + 1 < src.length) { str += src[i + 1]; i += 2; continue } }
    i++; if (ch === '"') break
  }
  return { str, end: i }
}

/** Read a single-quoted string (needed for comment-stripping pass). */
function readSingleQuoted(src, start) {
  let i = start + 1, str = "'"
  while (i < src.length) {
    const ch = src[i]; str += ch
    if (ch === '\\') { if (i + 1 < src.length) { str += src[i + 1]; i += 2; continue } }
    i++; if (ch === "'") break
  }
  return { str, end: i }
}
