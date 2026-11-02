type Unloadable = { flushOnUnload(): Promise<void> }

// Flushes every batcher when the page is hidden or unloaded.
// Returns a function that removes the listeners again.
export function flushOnPageUnload(batchers: readonly Unloadable[]): () => void {
  const flushOnPageHide = (): void => {
    for (const batcher of batchers) {
      void batcher.flushOnUnload().catch(() => undefined)
    }
  }
  const flushWhenHidden = (): void => {
    if (document.visibilityState === 'hidden') flushOnPageHide()
  }

  globalThis.addEventListener?.('pagehide', flushOnPageHide)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', flushWhenHidden)
  }

  return () => {
    globalThis.removeEventListener?.('pagehide', flushOnPageHide)
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', flushWhenHidden)
    }
  }
}
