import { useState, useEffect } from 'react'
import { getTheme, setTheme } from '../utils/storage'

export function useTheme() {
  const [theme, setThemeState] = useState(getTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    setTheme(theme)
  }, [theme])

  const toggle = () => setThemeState(t => t === 'light' ? 'dark' : 'light')
  return { theme, toggle }
}
