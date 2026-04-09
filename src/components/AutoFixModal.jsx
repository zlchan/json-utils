/**
 * AutoFixModal — shows a diff preview of auto-fix changes before applying.
 *
 * Props:
 *   original    string   — original (broken) input
 *   fixed       string   — repaired string
 *   changes     string[] — human-readable list of applied fixes
 *   error       string   — partial-fix error message (or null)
 *   onApply     ()=>void — apply the fix to the editor
 *   onClose     ()=>void — dismiss without applying
 */
import React from 'react'

export function AutoFixModal({ original, fixed, changes, error, onApply, onClose }) {
  const lines = buildDiffLines(original, fixed)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Auto-Fix Preview</span>
          <button className="icon-btn" onClick={onClose} title="Close">✕</button>
        </div>

        {/* Changes list */}
        <div className="modal-section">
          <div className="modal-section-label">Applied fixes</div>
          <ul className="fix-list">
            {changes.map((c, i) => (
              <li key={i} className="fix-item">
                <span className="fix-check">✓</span> {c}
              </li>
            ))}
          </ul>
        </div>

        {error && (
          <div className="error-banner" style={{ margin: '0 16px 12px' }}>
            <span className="err-icon">⚠</span>
            <span>{error}</span>
          </div>
        )}

        {/* Diff preview */}
        <div className="modal-section">
          <div className="modal-section-label">Diff preview</div>
          <div className="fix-diff">
            {lines.map((l, i) => (
              <div key={i} className={`fix-diff-line ${l.type}`}>
                <span className="fix-diff-symbol">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={onApply} disabled={!fixed}>Apply Fix</button>
        </div>
      </div>
    </div>
  )
}

/**
 * Build a simple line-level diff between two strings.
 * Good enough for showing JSON fix previews without a heavy library.
 */
function buildDiffLines(a, b) {
  const aLines = (a || '').split('\n')
  const bLines = (b || '').split('\n')

  // LCS-based diff on lines — O(n²) but JSON previews are small enough
  const lcs = computeLCS(aLines, bLines)
  const result = []
  let ai = 0, bi = 0, li = 0

  while (ai < aLines.length || bi < bLines.length) {
    if (li < lcs.length && ai < aLines.length && bi < bLines.length &&
        aLines[ai] === lcs[li] && bLines[bi] === lcs[li]) {
      result.push({ type: 'same', text: aLines[ai] })
      ai++; bi++; li++
    } else if (bi < bLines.length && (li >= lcs.length || bLines[bi] !== lcs[li])) {
      result.push({ type: 'add', text: bLines[bi] })
      bi++
    } else {
      result.push({ type: 'del', text: aLines[ai] })
      ai++
    }
  }

  // Trim unchanged lines — show context of 2 around changes
  return trimContext(result, 2)
}

function computeLCS(a, b) {
  // Cap for performance — previews won't need full LCS on huge files
  const MAX = 300
  const aa = a.slice(0, MAX), bb = b.slice(0, MAX)
  const dp = Array.from({ length: aa.length + 1 }, () => new Array(bb.length + 1).fill(0))
  for (let i = 1; i <= aa.length; i++)
    for (let j = 1; j <= bb.length; j++)
      dp[i][j] = aa[i-1] === bb[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1])

  const lcs = []
  let i = aa.length, j = bb.length
  while (i > 0 && j > 0) {
    if (aa[i-1] === bb[j-1]) { lcs.unshift(aa[i-1]); i--; j-- }
    else if (dp[i-1][j] > dp[i][j-1]) i--
    else j--
  }
  return lcs
}

function trimContext(lines, ctx) {
  // Mark lines near changes
  const changed = new Set()
  lines.forEach((l, i) => { if (l.type !== 'same') { for (let d = -ctx; d <= ctx; d++) changed.add(i + d) } })

  const result = []
  let skipping = false
  lines.forEach((l, i) => {
    if (changed.has(i)) {
      skipping = false
      result.push(l)
    } else if (!skipping) {
      result.push({ type: 'ellipsis', text: '···' })
      skipping = true
    }
  })

  // Remove leading/trailing ellipsis
  while (result.length && result[0].type === 'ellipsis') result.shift()
  while (result.length && result[result.length-1].type === 'ellipsis') result.pop()
  return result
}
