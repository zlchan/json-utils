/**
 * Web Worker: off-thread JSON parsing + tolerant normalisation.
 * All utility functions are inlined (no imports in ES-module workers during dev).
 *
 * Messages IN:  { id, input, tolerant }
 * Messages OUT: { id, type: 'result', data, error, stats, wasNormalized, normalizedSrc }
 *               { id, type: 'error',  message }
 */

// ── JSON parsing ─────────────────────────────────────────────────────────────

function parseJSON(str) {
  if (!str || !str.trim()) return { data: null, error: null }
  try { return { data: JSON.parse(str), error: null } }
  catch (e) { return { data: null, error: extractError(str, e.message) } }
}

function extractError(src, msg) {
  const lc = msg.match(/at line (\d+) column (\d+)/)
  if (lc) return { message: msg, line: +lc[1], column: +lc[2] }
  const pm = msg.match(/at position (\d+)/)
  if (pm) {
    const pos = +pm[1], before = src.slice(0, pos)
    return { message: msg, line: (before.match(/\n/g)||[]).length+1, column: pos-before.lastIndexOf('\n') }
  }
  return { message: msg, line: null, column: null }
}

function countKeys(obj) {
  if (typeof obj !== 'object' || obj === null) return 0
  let n = Array.isArray(obj) ? 0 : Object.keys(obj).length
  for (const v of (Array.isArray(obj) ? obj : Object.values(obj))) n += countKeys(v)
  return n
}

function getDepth(obj) {
  if (typeof obj !== 'object' || obj === null) return 0
  const vals = Array.isArray(obj) ? obj : Object.values(obj)
  if (!vals.length) return 1
  return 1 + Math.max(...vals.map(getDepth))
}

// ── Tolerant normalisation (mirrors passes 2,5,7,8,10 of autofix.js) ─────────

function transformOutside(src, fn) {
  let result='', chunk='', i=0
  while (i < src.length) {
    if (src[i] === '"') {
      result += fn(chunk); chunk = ''
      let s='"'; i++
      while (i < src.length) {
        const c=src[i]; s+=c
        if (c==='\\') { if (i+1<src.length) { s+=src[i+1]; i+=2; continue } }
        i++; if (c==='"') break
      }
      result += s
    } else { chunk += src[i]; i++ }
  }
  return result + fn(chunk)
}

function stripCommentsWorker(src) {
  let result='', i=0
  while (i < src.length) {
    if (src[i]==='"') {
      let s='"'; i++
      while (i<src.length) { const c=src[i]; s+=c; if(c==='\\'){ if(i+1<src.length){s+=src[i+1];i+=2;continue}} i++; if(c==='"')break }
      result+=s; continue
    }
    if (src[i]==="'") {
      let s="'"; i++
      while (i<src.length) { const c=src[i]; s+=c; if(c==='\\'){ if(i+1<src.length){s+=src[i+1];i+=2;continue}} i++; if(c==="'")break }
      result+=s; continue
    }
    if (src[i]==='/' && src[i+1]==='/') { while(i<src.length && src[i]!=='\n') i++; continue }
    if (src[i]==='/' && src[i+1]==='*') {
      i+=2
      while (i<src.length) { if(src[i]==='*'&&src[i+1]==='/'){i+=2;break}; result+=src[i]==='\n'?'\n':' '; i++ }
      continue
    }
    result += src[i]; i++
  }
  return result
}

function singleToDoubleWorker(src) {
  let result='', i=0
  while (i<src.length) {
    const ch=src[i]
    if(ch==='"'){ let s='"'; i++; while(i<src.length){ const c=src[i]; s+=c; if(c==='\\'){ if(i+1<src.length){s+=src[i+1];i+=2;continue}} i++; if(c==='"')break } result+=s }
    else if(ch==="'"){ let inner=''; i++; while(i<src.length){ const c=src[i]; if(c==='\\'&&src[i+1]==="'"){inner+="'";i+=2} else if(c==='"'){inner+='\\"';i++} else if(c==="'"){i++;break} else{inner+=c;i++}} result+='"'+inner+'"' }
    else { result+=ch; i++ }
  }
  return result
}

function normalizeTolerant(src) {
  src = src.replace(/\r\n/g,'\n').replace(/\r/g,'\n')
  src = stripCommentsWorker(src)
  src = transformOutside(src, c =>
    c.replace(/\bTrue\b/g,'true').replace(/\bFalse\b/g,'false')
     .replace(/\bNone\b/g,'null').replace(/\bundefined\b/g,'null')
     .replace(/\byes\b/gi,'true').replace(/\bno\b/gi,'false')
     .replace(/\bon\b/gi,'true').replace(/\boff\b/gi,'false')
     .replace(/(?<![.\d])-Infinity\b/g,'null')
     .replace(/\bInfinity\b/g,'null')
     .replace(/\bNaN\b/g,'null')
  )
  src = singleToDoubleWorker(src)
  src = transformOutside(src, c =>
    c.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, (_,b,k,col)=>`${b}"${k}"${col}`)
  )
  src = transformOutside(src, c => c.replace(/,(\s*[}\]])/g,'$1'))
  return src
}

// ── Worker message handler ────────────────────────────────────────────────────

self.onmessage = function(e) {
  const { id, input, tolerant } = e.data
  try {
    let src = input, wasNormalized = false
    if (tolerant) {
      const n = normalizeTolerant(input)
      if (n !== input) { src = n; wasNormalized = true }
    }
    const { data, error } = parseJSON(src)
    const stats = data !== null
      ? { size: new TextEncoder().encode(src).length, keys: countKeys(data), depth: getDepth(data) }
      : null
    self.postMessage({ id, type:'result', data, error, stats, wasNormalized, normalizedSrc: wasNormalized ? src : null })
  } catch(err) {
    self.postMessage({ id, type:'error', message: err.message })
  }
}
