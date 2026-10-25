import { useState } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'fx-theme'

/** Your saved choice, else your device's setting, else dark. */
export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* storage blocked */ }
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t
  try { localStorage.setItem(KEY, t) } catch { /* storage blocked */ }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (typeof document === 'undefined' ? 'dark' : ((document.documentElement.dataset.theme as Theme) || initialTheme())))
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }
  return { theme, toggle }
}
