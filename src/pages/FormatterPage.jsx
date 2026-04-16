import React, { useState, useMemo, useRef, useCallback } from 'react'
import { JsonEditor }    from '../components/JsonEditor'
import { TreeView }      from '../components/TreeView'
import { SavedPanel }    from '../components/SavedPanel'
import { AutoFixModal }  from '../components/AutoFixModal'
import { useJsonParser } from '../hooks/useJsonParser'
import { formatJSON, minifyJSON, formatBytes } from '../utils/json'
import { autoFixJson }   from '../utils/autofix'
import { addSave, setLastJSON } from '../utils/storage'

export function FormatterPage({ toast }) {
  const [input,       setInput]       = useState('')
  const [outputView,  setOutputView]  = useState('formatted') // 'formatted'|'minified'|'tree'
  const [tolerant,    setTolerant]    = useState(false)
  const [fixPreview,  setFixPreview]  = useState(null)        // null | { fixed, changes, error }
  const fileInputRef   = useRef(null)
  const expandAllRef   = useRef(null)
  const collapseAllRef = useRef(null)

  // ── Parsing (debounced, off-thread for large inputs) ────────────────────
  const { data, error, stats, loading, wasNormalized, normalizedSrc } =
    useJsonParser(input, tolerant)

  // ── Derived outputs ──────────────────────────────────────────────────────
  const formatted = useMemo(() => {
    if (!input.trim() || error) return ''
    const src = tolerant && normalizedSrc ? normalizedSrc : input
    const { result } = formatJSON(src)
    return result || ''
  }, [input, error, tolerant, normalizedSrc])

  const minified = useMemo(() => {
    if (!input.trim() || error) return ''
    const src = tolerant && normalizedSrc ? normalizedSrc : input
    const { result } = minifyJSON(src)
    return result || ''
  }, [input, error, tolerant, normalizedSrc])

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleChange = useCallback((val) => {
    setInput(val)
    setLastJSON(val)
  }, [])

  const handleFormat = useCallback(() => {
    if (!input.trim()) return
    if (error) return toast('Cannot format — fix errors first')
    const src = tolerant && normalizedSrc ? normalizedSrc : input
    const { result, error: e } = formatJSON(src)
    if (e) return toast('Format failed')
    handleChange(result)
    setOutputView('formatted')
    toast('Formatted!')
  }, [input, error, tolerant, normalizedSrc, handleChange, toast])

  const handleMinify = useCallback(() => {
    if (!input.trim()) return
    if (error) return toast('Cannot minify — fix errors first')
    const src = tolerant && normalizedSrc ? normalizedSrc : input
    const { result, error: e } = minifyJSON(src)
    if (e) return toast('Minify failed')
    handleChange(result)
    setOutputView('minified')
    toast('Minified!')
  }, [input, error, tolerant, normalizedSrc, handleChange, toast])

  // Open modal preview
  const handleAutoFix = useCallback(() => {
    if (!input.trim()) return toast('Nothing to fix')
    const { fixed, changes, error: fixErr } = autoFixJson(input)
    if (changes[0] === 'Already valid JSON — no fixes needed') {
      return toast('Already valid — no fixes needed')
    }
    setFixPreview({ fixed, changes, error: fixErr })
  }, [input, toast])

  // Apply immediately without modal — the primary action button
  const handleAutoFixDirect = useCallback(() => {
    if (!input.trim()) return toast('Nothing to fix')
    const { fixed, changes, error: fixErr } = autoFixJson(input)
    if (changes[0] === 'Already valid JSON — no fixes needed') {
      return toast('Already valid — no fixes needed')
    }
    handleChange(fixed)
    const label = changes.length === 1
      ? changes[0]
      : `${changes.length} fixes applied`
    toast(fixErr ? `Partially fixed (${fixErr})` : `✓ ${label}`)
  }, [input, handleChange, toast])

  const applyFix = useCallback(() => {
    if (!fixPreview?.fixed) return
    handleChange(fixPreview.fixed)
    setFixPreview(null)
    toast('Fix applied!')
  }, [fixPreview, handleChange, toast])

  const copyOutput = useCallback(() => {
    const text = outputView === 'minified' ? minified : formatted
    if (!text) return toast('Nothing to copy')
    navigator.clipboard.writeText(text).then(() => toast('Copied!'))
  }, [outputView, minified, formatted, toast])

  const downloadJSON = useCallback(() => {
    const text = outputView === 'minified' ? minified : formatted
    if (!text) return
    const blob = new Blob([text], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'output.json' })
    a.click()
    URL.revokeObjectURL(url)
    toast('Downloaded!')
  }, [outputView, minified, formatted, toast])

  const uploadFile = useCallback((e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => { handleChange(ev.target.result); toast(`Loaded: ${file.name}`) }
    reader.readAsText(file)
    e.target.value = ''
  }, [handleChange, toast])

  const handleSave = useCallback(() => {
    if (!input.trim()) return toast('Nothing to save')
    if (error)         return toast('Cannot save invalid JSON')
    const label = prompt('Save as:', `JSON ${new Date().toLocaleTimeString()}`)
    if (!label) return
    addSave(label, formatted || input)
    toast('Saved!')
  }, [input, error, formatted, toast])

  const isValid = input.trim() && !error && !loading

  return (
    <div>
      {/* Toolbar */}
      <div className="toolbar">
        <button className="btn primary" onClick={handleFormat}  disabled={!input.trim() || loading}>Format</button>
        <button className="btn"         onClick={handleMinify}  disabled={!input.trim() || loading}>Minify</button>
        {/* Auto-Fix: split button — Apply directly (primary) + Preview (secondary) */}
        <div className="split-btn" title="Auto-fix common JSON errors">
          <button
            className="btn warn split-btn-main"
            onClick={handleAutoFixDirect}
            disabled={!input.trim() || loading}
          >
            ✦ Auto-Fix
          </button>
          <button
            className="btn warn split-btn-arrow"
            onClick={handleAutoFix}
            disabled={!input.trim() || loading}
            title="Preview changes before applying"
            aria-label="Preview auto-fix changes"
          >
            ▾
          </button>
        </div>
        <div className="toolbar-sep" />

        {/* Strict / Tolerant toggle */}
        <label className="toggle-label" title="Tolerant mode auto-normalises single quotes, Python literals, and unquoted keys before parsing">
          <input
            type="checkbox"
            checked={tolerant}
            onChange={e => setTolerant(e.target.checked)}
            style={{ marginRight: 5 }}
          />
          Tolerant Mode
        </label>
        <div className="toolbar-sep" />

        <button className="btn" onClick={() => fileInputRef.current?.click()}>⬆ Upload</button>
        <input ref={fileInputRef} type="file" accept=".json,application/json,text/plain" onChange={uploadFile} style={{ display: 'none' }} />
        <button className="btn" onClick={downloadJSON} disabled={!isValid}>⬇ Download</button>
        <button className="btn" onClick={copyOutput}   disabled={!isValid}>⎘ Copy</button>
        <div className="toolbar-sep" />
        <button className="btn" onClick={handleSave}>💾 Save</button>
        <SavedPanel onLoad={(json) => { handleChange(json); toast('Loaded!') }} />
        <div className="toolbar-sep" />
        <button className="btn danger sm" onClick={() => { handleChange(''); toast('Cleared') }} disabled={!input.trim()}>Clear</button>
      </div>

      {/* Tolerant normalisation notice */}
      {tolerant && wasNormalized && (
        <div className="info-banner">
          <span>ℹ</span>
          <span>Tolerant mode normalised input before parsing — the original text is unchanged. Click <strong>Format</strong> to apply.</span>
        </div>
      )}

      {/* Error Banner */}
      {error && input.trim() && !loading && (
        <div className="error-banner">
          <span className="err-icon">⚠</span>
          <div>
            <div>
              <strong>
                JSON Error{error.line ? ` at line ${error.line}` : ''}
                {error.column ? `, col ${error.column}` : ''}
              </strong>
              {!tolerant && (
                <button
                  className="btn sm warn"
                  style={{ marginLeft: 12 }}
                  onClick={handleAutoFixDirect}
                >
                  ✦ Auto-Fix
                </button>
              )}
            </div>
            <div style={{ marginTop: 3, fontFamily: 'var(--mono)', fontSize: '0.8rem' }}>{error.message}</div>
          </div>
        </div>
      )}

      {/* Loading indicator */}
      {loading && (
        <div className="info-banner">
          <span className="spinner" /> Parsing large JSON…
        </div>
      )}

      {/* Main Grid */}
      <div className="formatter-grid" style={{ marginTop: 12 }}>
        {/* Input panel */}
        <div>
          <div className="editor-wrap">
            <div className="editor-header">
              <span className="editor-title">Input</span>
              <div className="editor-actions">
                <button className="btn sm" onClick={() =>
                  navigator.clipboard.readText?.()
                    .then(t => handleChange(t))
                    .catch(() => toast('Use Ctrl+V to paste'))
                }>Paste</button>
              </div>
            </div>
            <JsonEditor value={input} onChange={handleChange} label="Input JSON" error={error} />
            <div className="status-bar">
              {loading                  && <span className="info">⏳ parsing…</span>}
              {!input.trim() && !loading && <span className="info">Ready</span>}
              {input.trim() && error && !loading && <span className="err">✗ Invalid JSON</span>}
              {isValid                  && <span className="ok">✓ Valid JSON</span>}
              {stats && !loading && <>
                <span className="info">{formatBytes(stats.size)}</span>
                <span className="info">{stats.keys.toLocaleString()} keys</span>
                <span className="info">depth {stats.depth}</span>
              </>}
            </div>
          </div>
        </div>

        {/* Output panel */}
        <div>
          <div className="editor-wrap">
            <div className="editor-header">
              <span className="editor-title">Output</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {outputView === 'tree' && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn sm" onClick={() => expandAllRef.current?.()}>Expand All</button>
                    <button className="btn sm" onClick={() => collapseAllRef.current?.()}>Collapse All</button>
                  </div>
                )}
                <div className="view-tabs">
                  <button className={`view-tab${outputView==='formatted'?' active':''}`} onClick={() => setOutputView('formatted')}>Formatted</button>
                  <button className={`view-tab${outputView==='minified' ?' active':''}`} onClick={() => setOutputView('minified')}>Minified</button>
                  <button className={`view-tab${outputView==='tree'     ?' active':''}`} onClick={() => setOutputView('tree')}>Tree</button>
                </div>
              </div>
            </div>

            {outputView === 'tree'
              ? <TreeView data={data} onExpandAll={expandAllRef} onCollapseAll={collapseAllRef} />
              : (
                <JsonEditor
                  value={outputView === 'minified' ? minified : formatted}
                  onChange={() => {}}
                  label="Output JSON"
                  readOnly
                />
              )
            }

            <div className="status-bar">
              {outputView === 'formatted' && formatted && <span className="info">{formatBytes(new Blob([formatted]).size)}</span>}
              {outputView === 'minified'  && minified  && <span className="info">{formatBytes(new Blob([minified]).size)}</span>}
              {outputView === 'tree'      && isValid   && <span className="ok">Virtualised tree</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Auto-Fix modal */}
      {fixPreview && (
        <AutoFixModal
          original={input}
          fixed={fixPreview.fixed}
          changes={fixPreview.changes}
          error={fixPreview.error}
          onApply={applyFix}
          onClose={() => setFixPreview(null)}
        />
      )}
    </div>
  )
}
