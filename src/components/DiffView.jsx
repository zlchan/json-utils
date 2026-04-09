import React, { useMemo } from 'react'
import { diffJSON, diffSummary } from '../utils/diff'

function displayVal(v) {
  if (v === undefined) return ''
  if (typeof v === 'object' && v !== null) return JSON.stringify(v)
  if (typeof v === 'string') return `"${v}"`
  return String(v)
}

function InlineDiff({ entries }) {
  if (!entries.length) return <div className="no-data">No differences detected ✓</div>
  return (
    <div className="diff-inline">
      {entries.map((e, i) => {
        if (e.type === 'same') return null
        return (
          <div key={i} className="diff-inline-row">
            <span className={`diff-inline-symbol ${e.type === 'added' ? 'add' : e.type === 'removed' ? 'del' : 'chg'}`}>
              {e.type === 'added' ? '+' : e.type === 'removed' ? '−' : '~'}
            </span>
            <div className="diff-inline-content" style={{ flex: 1 }}>
              <span style={{ color: 'var(--text3)', marginRight: 8, fontSize: '0.75rem' }}>{e.path}</span>
              {e.type === 'changed' && (
                <>
                  <span className="diff-inline-content del">{displayVal(e.oldVal)}</span>
                  <span style={{ margin: '0 6px', color: 'var(--text3)' }}>→</span>
                  <span className="diff-inline-content add">{displayVal(e.newVal)}</span>
                </>
              )}
              {e.type === 'added' && <span className="diff-inline-content add">{displayVal(e.newVal)}</span>}
              {e.type === 'removed' && <span className="diff-inline-content del">{displayVal(e.oldVal)}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function buildAnnotatedLines(obj, diffEntries, side) {
  const typemap = {}
  for (const e of diffEntries) {
    typemap[e.path] = e.type
  }

  const lines = []

  function walk(value, path, depth, keyLabel) {
    const type = typemap[path]
    const indent = '  '.repeat(depth)
    const prefix = keyLabel !== null ? `"${keyLabel}": ` : ''

    if (typeof value !== 'object' || value === null) {
      const relevant =
        (side === 'left' && (type === 'removed' || type === 'changed' || type === 'same')) ||
        (side === 'right' && (type === 'added' || type === 'changed' || type === 'same')) ||
        type === undefined

      if (!relevant) return

      const lineType =
        type === 'added' ? 'add' :
        type === 'removed' ? 'del' :
        type === 'changed' ? 'chg' : 'same'

      lines.push({ text: `${indent}${prefix}${JSON.stringify(value)}`, type: lineType })
      return
    }

    const isArr = Array.isArray(value)
    const entries = isArr ? value.map((v, i) => [i, v]) : Object.entries(value)
    lines.push({ text: `${indent}${prefix}${isArr ? '[' : '{'}`, type: 'same' })

    for (const [k, v] of entries) {
      const childPath = path ? `${path}.${k}` : String(k)
      walk(v, childPath, depth + 1, k)
    }

    lines.push({ text: `${indent}${isArr ? ']' : '}'}`, type: 'same' })
  }

  walk(obj, '', 0, null)
  return lines
}

function SideBySideDiff({ aData, bData, entries }) {
  const aLines = useMemo(() => buildAnnotatedLines(aData, entries, 'left'), [aData, entries])
  const bLines = useMemo(() => buildAnnotatedLines(bData, entries, 'right'), [bData, entries])

  return (
    <div className="diff-side-grid">
      <div className="diff-side-panel">
        <div className="diff-side-header">Original (A)</div>
        <div className="diff-side-body">
          {aLines.map((l, i) => (
            <div key={i} className={`diff-line ${l.type}`}>{l.text || '\u00A0'}</div>
          ))}
        </div>
      </div>
      <div className="diff-side-panel">
        <div className="diff-side-header">Modified (B)</div>
        <div className="diff-side-body">
          {bLines.map((l, i) => (
            <div key={i} className={`diff-line ${l.type}`}>{l.text || '\u00A0'}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function DiffView({ aData, bData, mode = 'side-by-side' }) {
  const entries = useMemo(() => {
    if (aData === null || bData === null) return []
    return diffJSON(aData, bData)
  }, [aData, bData])

  const summary = useMemo(() => diffSummary(entries), [entries])

  if (aData === null || bData === null) {
    return <div className="no-data">Enter valid JSON in both panels to see the diff</div>
  }

  return (
    <div className="diff-result">
      <div className="diff-result-header">
        <div className="diff-legend">
          <div className="diff-legend-item"><span className="diff-dot add" />Added</div>
          <div className="diff-legend-item"><span className="diff-dot del" />Removed</div>
          <div className="diff-legend-item"><span className="diff-dot chg" />Changed</div>
        </div>
      </div>
      <div className="diff-body">
        {mode === 'side-by-side'
          ? <SideBySideDiff aData={aData} bData={bData} entries={entries} />
          : <InlineDiff entries={entries} />
        }
      </div>
      <div className="diff-summary">
        <div className="diff-summary-item"><span className="diff-summary-count add">+{summary.added}</span> added</div>
        <div className="diff-summary-item"><span className="diff-summary-count del">−{summary.removed}</span> removed</div>
        <div className="diff-summary-item"><span className="diff-summary-count chg">~{summary.changed}</span> changed</div>
      </div>
    </div>
  )
}
