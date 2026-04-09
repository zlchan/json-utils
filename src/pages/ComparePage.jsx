import React, { useState, useRef, useCallback } from 'react'
import { JsonEditor }    from '../components/JsonEditor'
import { DiffView }      from '../components/DiffView'
import { useJsonParser } from '../hooks/useJsonParser'
import { formatJSON, formatBytes } from '../utils/json'

export function ComparePage({ toast }) {
  const [inputA, setInputA] = useState('')
  const [inputB, setInputB] = useState('')
  const [diffMode, setDiffMode] = useState('side-by-side')
  const [tolerant, setTolerant] = useState(false)
  const fileARef = useRef(null)
  const fileBRef = useRef(null)

  const { data: dataA, error: errA, stats: statsA, loading: loadA } = useJsonParser(inputA, tolerant)
  const { data: dataB, error: errB, stats: statsB, loading: loadB } = useJsonParser(inputB, tolerant)

  const handleFormat = useCallback((side) => {
    const input = side === 'a' ? inputA : inputB
    const { result, error } = formatJSON(input)
    if (error) return toast('Invalid JSON')
    side === 'a' ? setInputA(result) : setInputB(result)
    toast('Formatted!')
  }, [inputA, inputB, toast])

  const uploadFile = useCallback((side, e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      side === 'a' ? setInputA(ev.target.result) : setInputB(ev.target.result)
      toast(`Loaded: ${file.name}`)
    }
    reader.readAsText(file)
    e.target.value = ''
  }, [toast])

  const swapPanels = useCallback(() => {
    setInputA(inputB); setInputB(inputA)
    toast('Swapped!')
  }, [inputA, inputB, toast])

  const copyPanel = useCallback((side) => {
    const val = side === 'a' ? inputA : inputB
    if (!val) return
    navigator.clipboard.writeText(val).then(() => toast('Copied!'))
  }, [inputA, inputB, toast])

  function PanelStatus({ error, input, stats, loading }) {
    return (
      <div className="status-bar">
        {loading               && <span className="info">⏳ parsing…</span>}
        {!input.trim()         && <span className="info">Empty</span>}
        {input.trim() && error && !loading && <span className="err">✗ Invalid</span>}
        {input.trim() && !error && !loading && <span className="ok">✓ Valid</span>}
        {stats && !loading && <>
          <span className="info">{formatBytes(stats.size)}</span>
          <span className="info">{stats.keys.toLocaleString()} keys</span>
        </>}
      </div>
    )
  }

  return (
    <div>
      <div className="toolbar">
        <button className="btn" onClick={swapPanels}>⇄ Swap</button>
        <div className="toolbar-sep" />
        <label className="toggle-label">
          <input type="checkbox" checked={tolerant} onChange={e => setTolerant(e.target.checked)} style={{ marginRight: 5 }} />
          Tolerant Mode
        </label>
        <div className="toolbar-sep" />
        <span style={{ fontSize: '0.8rem', color: 'var(--text2)', marginRight: 4 }}>View:</span>
        <button className={`btn${diffMode === 'side-by-side' ? ' primary' : ''}`} onClick={() => setDiffMode('side-by-side')}>Side by Side</button>
        <button className={`btn${diffMode === 'inline'       ? ' primary' : ''}`} onClick={() => setDiffMode('inline')}>Inline</button>
      </div>

      <div className="compare-grid">
        {/* Panel A */}
        <div className="editor-wrap">
          <div className="editor-header">
            <span className="editor-title">JSON A (Original)</span>
            <div className="editor-actions">
              <button className="btn sm" onClick={() => fileARef.current?.click()}>⬆</button>
              <input ref={fileARef} type="file" accept=".json" onChange={e => uploadFile('a', e)} style={{ display: 'none' }} />
              <button className="btn sm" onClick={() => handleFormat('a')} disabled={!inputA.trim()}>Format</button>
              <button className="btn sm" onClick={() => copyPanel('a')} disabled={!inputA.trim()}>⎘</button>
              <button className="btn sm danger" onClick={() => setInputA('')} disabled={!inputA.trim()}>✕</button>
            </div>
          </div>
          <JsonEditor value={inputA} onChange={setInputA} label="JSON A" error={errA} />
          <PanelStatus error={errA} input={inputA} stats={statsA} loading={loadA} />
        </div>

        {/* Panel B */}
        <div className="editor-wrap">
          <div className="editor-header">
            <span className="editor-title">JSON B (Modified)</span>
            <div className="editor-actions">
              <button className="btn sm" onClick={() => fileBRef.current?.click()}>⬆</button>
              <input ref={fileBRef} type="file" accept=".json" onChange={e => uploadFile('b', e)} style={{ display: 'none' }} />
              <button className="btn sm" onClick={() => handleFormat('b')} disabled={!inputB.trim()}>Format</button>
              <button className="btn sm" onClick={() => copyPanel('b')} disabled={!inputB.trim()}>⎘</button>
              <button className="btn sm danger" onClick={() => setInputB('')} disabled={!inputB.trim()}>✕</button>
            </div>
          </div>
          <JsonEditor value={inputB} onChange={setInputB} label="JSON B" error={errB} />
          <PanelStatus error={errB} input={inputB} stats={statsB} loading={loadB} />
        </div>
      </div>

      {errA && inputA.trim() && !loadA && (
        <div className="error-banner" style={{ marginBottom: 8 }}>
          <span className="err-icon">⚠</span>
          <span>JSON A — {errA.message}{errA.line ? ` (line ${errA.line})` : ''}</span>
        </div>
      )}
      {errB && inputB.trim() && !loadB && (
        <div className="error-banner" style={{ marginBottom: 8 }}>
          <span className="err-icon">⚠</span>
          <span>JSON B — {errB.message}{errB.line ? ` (line ${errB.line})` : ''}</span>
        </div>
      )}

      <DiffView aData={dataA} bData={dataB} mode={diffMode} />
    </div>
  )
}
