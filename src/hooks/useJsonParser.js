/**
 * useJsonParser — debounced, off-thread JSON parsing hook.
 *
 * For small inputs (< WORKER_THRESHOLD chars) parses synchronously on the
 * main thread to avoid worker round-trip latency.
 * For large inputs the parse runs in a Web Worker so the UI never freezes.
 *
 * Returns: { data, error, stats, loading, wasNormalized, normalizedSrc }
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { parseJSON, getStats } from '../utils/json'
import { tolerantParse } from '../utils/tolerant'

const WORKER_THRESHOLD = 100_000   // chars — use worker above this
const DEBOUNCE_MS_SMALL = 150
const DEBOUNCE_MS_LARGE = 400

let workerInstance = null
function getWorker() {
  if (!workerInstance) {
    workerInstance = new Worker(new URL('../workers/parser.worker.js', import.meta.url), { type: 'module' })
  }
  return workerInstance
}

export function useJsonParser(input, tolerant = false) {
  const [state, setState] = useState({ data: null, error: null, stats: null, loading: false, wasNormalized: false, normalizedSrc: null })
  const timerRef = useRef(null)
  const pendingIdRef = useRef(null)

  const parse = useCallback((src, tol) => {
    if (!src || !src.trim()) {
      setState({ data: null, error: null, stats: null, loading: false, wasNormalized: false, normalizedSrc: null })
      return
    }

    const large = src.length > WORKER_THRESHOLD
    const delay = large ? DEBOUNCE_MS_LARGE : DEBOUNCE_MS_SMALL

    clearTimeout(timerRef.current)
    if (large) setState(s => ({ ...s, loading: true }))

    timerRef.current = setTimeout(() => {
      if (large) {
        // Off-thread parse
        const id = Date.now() + Math.random()
        pendingIdRef.current = id
        const worker = getWorker()

        const handler = (e) => {
          if (e.data.id !== id) return
          worker.removeEventListener('message', handler)
          if (pendingIdRef.current !== id) return // superseded

          if (e.data.type === 'result') {
            setState({
              data: e.data.data,
              error: e.data.error,
              stats: e.data.stats,
              loading: false,
              wasNormalized: e.data.wasNormalized,
              normalizedSrc: e.data.normalizedSrc,
            })
          } else {
            setState({ data: null, error: { message: e.data.message, line: null, column: null }, stats: null, loading: false, wasNormalized: false, normalizedSrc: null })
          }
        }
        worker.addEventListener('message', handler)
        worker.postMessage({ id, input: src, tolerant: tol })
      } else {
        // Synchronous parse on main thread
        let result
        if (tol) {
          result = tolerantParse(src)
        } else {
          const { data, error } = parseJSON(src)
          const stats = data !== null ? getStats(src) : null
          result = { data, error, stats, wasNormalized: false, normalizedSrc: null }
        }
        setState({ ...result, loading: false })
      }
    }, delay)
  }, [])

  useEffect(() => {
    parse(input, tolerant)
    return () => clearTimeout(timerRef.current)
  }, [input, tolerant, parse])

  return state
}
