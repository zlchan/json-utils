import React from 'react'

export function ToastContainer({ toasts }) {
  if (!toasts.length) return null
  return (
    <div className="toast-container">
      {toasts.map(t => <div key={t.id} className="toast">{t.msg}</div>)}
    </div>
  )
}
