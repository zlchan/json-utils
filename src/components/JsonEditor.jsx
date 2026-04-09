/**
 * JsonEditor — textarea with:
 *  - Synced line numbers
 *  - Error line highlight (red gutter + red bg on that line)
 *  - Auto scroll-to-error
 *  - Column indicator underline via overlay
 *  - Tab key support
 */
import React, { useRef, useCallback, useEffect, useMemo } from 'react'

const LINE_HEIGHT = 22.4  // px — must match CSS line-height (1.6 × 14px)

export function JsonEditor({ value, onChange, label, readOnly = false, error = null }) {
  const taRef   = useRef(null)
  const lnRef   = useRef(null)
  const ovRef   = useRef(null)   // overlay for error underline

  const lines = useMemo(() => (value || '').split('\n'), [value])

  // Sync scroll between gutter, overlay, and textarea
  const syncScroll = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    if (lnRef.current) lnRef.current.scrollTop = ta.scrollTop
    if (ovRef.current) { ovRef.current.scrollTop = ta.scrollTop; ovRef.current.scrollLeft = ta.scrollLeft }
  }, [])

  // Scroll textarea to error line
  useEffect(() => {
    if (!error?.line || !taRef.current) return
    const targetScroll = (error.line - 1) * LINE_HEIGHT - 80
    taRef.current.scrollTop = Math.max(0, targetScroll)
    syncScroll()
  }, [error, syncScroll])

  const handleTab = useCallback((e) => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const ta = e.target
    const s = ta.selectionStart, en = ta.selectionEnd
    const next = ta.value.slice(0, s) + '  ' + ta.value.slice(en)
    onChange(next)
    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2 })
  }, [onChange])

  const errLine = error?.line ?? null

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

      {/* Editor stack: textarea + overlay */}
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        {/* Error highlight overlay — sits behind text, scrolls in sync */}
        <div
          ref={ovRef}
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0,
            pointerEvents: 'none',
            overflow: 'hidden',
            fontFamily: 'var(--mono)', fontSize: '0.82rem', lineHeight: '1.6',
            padding: '12px',
            whiteSpace: 'pre',
          }}
        >
          {errLine && lines.map((_, i) => (
            <div
              key={i}
              style={{
                height: `${LINE_HEIGHT}px`,
                background: i + 1 === errLine ? 'var(--error-bg)' : 'transparent',
                borderLeft: i + 1 === errLine ? '2px solid var(--error)' : '2px solid transparent',
                marginLeft: -2,
              }}
            />
          ))}
        </div>

        <textarea
          ref={taRef}
          className={`json-input${errLine && value.trim() ? ' has-error' : ''}`}
          style={{ position: 'relative', zIndex: 1, background: 'transparent' }}
          value={value}
          onChange={e => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={handleTab}
          readOnly={readOnly}
          placeholder={`Paste ${label || 'JSON'} here...`}
          spellCheck={false}
          aria-label={label}
          aria-invalid={!!errLine}
        />
      </div>
    </div>
  )
}
