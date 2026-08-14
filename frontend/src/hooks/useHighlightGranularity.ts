import { useLocalStorageState } from './useLocalStorageState'

export type HighlightGranularity = 'word' | 'sentence' | 'off'

/** Adjustable highlight granularity (Phase 3, PRODUCT_PLAN.md §5). */
export function useHighlightGranularity() {
  return useLocalStorageState<HighlightGranularity>('verbis:highlight-granularity', 'word')
}
