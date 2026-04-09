/**
 * Tolerant JSON parser.
 *
 * Applies the same normalisation pipeline as autofix but silently,
 * so users can work with "almost JSON" (logs, backend debug output, etc.)
 * without needing to manually fix the input.
 *
 * Returns { data, normalized, error }
 *   - data: parsed JS value or null
 *   - normalized: the string that was actually parsed (may differ from input)
 *   - error: { message, line, column } or null
 */
import { autoFixJson } from './autofix'
import { parseJSON } from './json'

export function tolerantParse(input) {
  if (!input || !input.trim()) return { data: null, normalized: input, error: null }

  // Try strict parse first — avoid any mutation if already valid
  const strict = parseJSON(input)
  if (!strict.error) return { data: strict.data, normalized: input, error: null }

  // Apply autofix pipeline silently
  const { fixed } = autoFixJson(input)
  const result = parseJSON(fixed)

  return {
    data: result.data,
    normalized: fixed,
    error: result.error,
  }
}
