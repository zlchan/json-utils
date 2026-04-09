import React, { useState, useCallback } from 'react'
import { getSaves, deleteSave, clearSaves } from '../utils/storage'

export function SavedPanel({ onLoad }) {
  const [saves, setSaves] = useState(getSaves)
  const [expanded, setExpanded] = useState(false)

  const refresh = useCallback(() => setSaves(getSaves()), [])

  const handleDelete = useCallback((id) => {
    deleteSave(id)
    refresh()
  }, [refresh])

  const handleClear = useCallback(() => {
    if (confirm('Clear all saved JSON? This cannot be undone.')) {
      clearSaves()
      refresh()
    }
  }, [refresh])

  if (!expanded) {
    return (
      <button className="btn sm" onClick={() => setExpanded(true)}>
        📂 Saved ({saves.length})
      </button>
    )
  }

  return (
    <div className="saved-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3>Saved JSON</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          {saves.length > 0 && <button className="btn sm danger" onClick={handleClear}>Clear All</button>}
          <button className="btn sm" onClick={() => setExpanded(false)}>✕ Close</button>
        </div>
      </div>
      {saves.length === 0
        ? <div className="no-data" style={{ padding: 24 }}>No saved JSON yet</div>
        : (
          <div className="saved-list">
            {saves.map(s => (
              <div key={s.id} className="saved-item">
                <div>
                  <div className="saved-item-meta">
                    <strong>{s.label}</strong>
                    <span style={{ marginLeft: 8 }}>{new Date(s.date).toLocaleString()}</span>
                  </div>
                  <div className="saved-item-preview">{s.json.slice(0, 100)}</div>
                </div>
                <div className="saved-item-actions">
                  <button className="btn sm" onClick={() => { onLoad(s.json); setExpanded(false) }}>Load</button>
                  <button className="btn sm danger" onClick={() => handleDelete(s.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )
      }
    </div>
  )
}
