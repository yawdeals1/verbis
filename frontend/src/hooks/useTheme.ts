import { useEffect } from 'react'
import { useLocalStorageState } from './useLocalStorageState'

export type Theme = 'system' | 'light' | 'dark'

/** Reading theme (Phase 3, PRODUCT_PLAN.md §5). 'system' defers to prefers-color-scheme. */
export function useTheme() {
  const [theme, setTheme] = useLocalStorageState<Theme>('verbis:theme', 'system')

  useEffect(() => {
    if (theme === 'system') {
      delete document.documentElement.dataset.theme
    } else {
      document.documentElement.dataset.theme = theme
    }
  }, [theme])

  return [theme, setTheme] as const
}
