/**
 * Runs `fn` over `items` with at most `concurrency` in flight at once.
 *
 * Unbounded `Promise.all` over a few hundred items (the Speechify voice
 * catalog's first-ever sync, see routes/voices.ts) opens that many
 * simultaneous connections to the Studio API and starts failing with
 * connect timeouts well before they all complete.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0

  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}
