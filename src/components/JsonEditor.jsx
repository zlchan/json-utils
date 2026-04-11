/**
 * JsonEditor
 *  - Line-number gutter (synced scroll)
 *  - Error line highlight overlay
 *  - Auto scroll-to-error line
 *  - Tab key inserts spaces
 *  - NO line wrapping — horizontal scroll instead
 */
import React, { useRef, useCallback, useEffect, useMemo } from 'react'

// Must match CSS: font-size 14px × line-height 1.6 = 22.4px
const LINE_HEIGHT = 22.4

export function JsonEditor({ value, onChange, label, readOnly = false, error = null }) {
  const taRef  = useRef(null)
  const lnRef  = useRef(null)
  const ovRef  = useRef(null)

  const lines = useMemo(() => (value || '').split('\n'), [value])
  const errLine = error?.line ?? null

  // Keep gutter + overlay in sync with textarea scroll
  const syncScroll = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    if (lnRef.current)  lnRef.current.scrollTop = ta.scrollTop
    if (ovRef.current) {
      ovRef.current.scrollTop  = ta.scrollTop
      ovRef.current.scrollLeft = ta.scrollLeft
    }
  }, [])

  // Auto-scroll to error line when error changes
  useEffect(() => {
    if (!errLine || !taRef.current) return
    taRef.current.scrollTop = Math.max(0, (errLine - 1) * LINE_HEIGHT - 80)
    syncScroll()
  }, [errLine, syncScroll])

  const handleTab = useCallback((e) => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const ta = e.target
    const s = ta.selectionStart, end = ta.selectionEnd
    const next = ta.value.slice(0, s) + '  ' + ta.value.slice(end)
    onChange(next)
    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2 })
  }, [onChange])

  return (
    <div className="editor-body">
      {/* Gutter */}
      <div ref={lnRef} className="line-numbers" aria-hidden="true">
        {lines.map((_, i) => (
          <span key={i} className={errLine === i + 1 ? 'err-line' : ''}>
            {i + 1}
          </span>
        ))}
      </div>

      {/* Textarea + error overlay wrapper */}
      <div className="editor-textarea-wrap">
        {/* Error highlight — absolutely positioned behind the textarea */}
        {errLine && (
          <div ref={ovRef} className="editor-error-overlay" aria-hidden="true">
            {lines.map((_, i) => (
              <div
                key={i}
                style={{
                  height: `${LINE_HEIGHT}px`,
                  background: i + 1 === errLine ? 'var(--error-bg)' : 'transparent',
                  borderLeft: i + 1 === errLine
                    ? '2px solid var(--error)'
                    : '2px solid transparent',
                  marginLeft: -2,
                }}
              />
            ))}
          </div>
        )}

        <textarea
          ref={taRef}
          className="json-input"
          value={value}
          onChange={e => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={handleTab}
          readOnly={readOnly}
          placeholder={`Paste ${label || 'JSON'} here…`}
          spellCheck={false}
          aria-label={label}
          aria-invalid={!!errLine}
        />
      </div>
    </div>
  )
}
