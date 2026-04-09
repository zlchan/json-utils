/**
 * Web Worker: off-thread JSON parsing.
 * Handles large JSON without blocking the UI thread.
 *
 * Messages IN:  { id, input, tolerant }
 * Messages OUT: { id, type: 'result', data, error, stats, wasNormalized, normalizedSrc }
 */

function parseJSON(str) {
  if (!str || !str.trim()) return { data: null, error: null }
  try {
    return { data: JSON.parse(str), error: null }
  } catch (e) {
    return { data: null, error: extractError(str, e.message) }
  }
}

function extractError(src, msg) {
  const lcMatch = msg.match(/at line (\d+) column (\d+)/)
  if (lcMatch) return { message: msg, line: +lcMatch[1], column: +lcMatch[2] }
  const posMatch = msg.match(/at position (\d+)/)
  if (posMatch) {
    const pos = +posMatch[1]
    const before = src.slice(0, pos)
    return { message: msg, line: (before.match(/\n/g)||[]).length+1, column: pos-before.lastIndexOf('\n') }
  }
  return { message: msg, line: null, column: null }
}

function countKeys(obj) {
  if (typeof obj !== 'object' || obj === null) return 0
  let count = Array.isArray(obj) ? 0 : Object.keys(obj).length
  const vals = Array.isArray(obj) ? obj : Object.values(obj)
  for (const v of vals) count += countKeys(v)
  return count
}

function getDepth(obj) {
  if (typeof obj !== 'object' || obj === null) return 0
  const vals = Array.isArray(obj) ? obj : Object.values(obj)
  if (!vals.length) return 1
  return 1 + Math.max(...vals.map(getDepth))
}

function transformOutside(src, fn) {
  let result='', chunk='', i=0
  while(i<src.length){
    if(src[i]==='"'){
      result+=fn(chunk); chunk=''
      let s='"'; i++
      while(i<src.length){
        const c=src[i]; s+=c
        if(c==='\\'){if(i+1<src.length){s+=src[i+1];i+=2;continue}}
        i++; if(c==='"')break
      }
      result+=s
    } else { chunk+=src[i]; i++ }
  }
  return result+fn(chunk)
}

function singleToDouble(src) {
  let result='', i=0
  while(i<src.length){
    const ch=src[i]
    if(ch==='"'){
      let s='"'; i++
      while(i<src.length){
        const c=src[i]; s+=c
        if(c==='\\'){if(i+1<src.length){s+=src[i+1];i+=2;continue}}
        i++; if(c==='"')break
      }
      result+=s
    } else if(ch==="'"){
      let inner=''; i++
      while(i<src.length){
        const c=src[i]
        if(c==='\\'&&src[i+1]==="'"){inner+="'";i+=2}
        else if(c==='"'){inner+='\\"';i++}
        else if(c==="'"){i++;break}
        else{inner+=c;i++}
      }
      result+='"'+inner+'"'
    } else { result+=ch; i++ }
  }
  return result
}

function normalizeTolerant(src) {
  src = src.replace(/\r\n/g,'\n').replace(/\r/g,'\n')
  src = transformOutside(src, c =>
    c.replace(/\bTrue\b/g,'true').replace(/\bFalse\b/g,'false')
     .replace(/\bNone\b/g,'null').replace(/\bundefined\b/g,'null')
  )
  src = singleToDouble(src)
  src = transformOutside(src, c =>
    c.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, (_,b,k,col)=>`${b}"${k}"${col}`)
  )
  src = transformOutside(src, c => c.replace(/,(\s*[}\]])/g,'$1'))
  return src
}

self.onmessage = function(e) {
  const { id, input, tolerant } = e.data
  try {
    let src = input
    let wasNormalized = false
    if (tolerant) {
      const n = normalizeTolerant(input)
      if (n !== input) { src = n; wasNormalized = true }
    }
    const { data, error } = parseJSON(src)
    const stats = data !== null ? { size: new TextEncoder().encode(src).length, keys: countKeys(data), depth: getDepth(data) } : null
    self.postMessage({ id, type: 'result', data, error, stats, wasNormalized, normalizedSrc: wasNormalized ? src : null })
  } catch(err) {
    self.postMessage({ id, type: 'error', message: err.message })
  }
}
