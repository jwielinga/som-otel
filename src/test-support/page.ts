import { vi } from 'vitest'
import { stubFetchKeepalive } from './keepalive.js'

// Page events and fetch keepalive support: all the page-level state the SDK reads.
// Undo with vi.unstubAllGlobals().
export function stubPage(options: { keepaliveSupported: boolean }) {
  const windowEvents = new EventTarget()
  const documentEvents = new EventTarget()
  let listeners = 0

  const track = (target: EventTarget) => ({
    add: (type: string, listener: EventListener) => {
      listeners++
      target.addEventListener(type, listener)
    },
    remove: (type: string, listener: EventListener) => {
      listeners--
      target.removeEventListener(type, listener)
    },
  })
  const windowTracking = track(windowEvents)
  const documentTracking = track(documentEvents)
  const documentStub = {
    visibilityState: 'visible',
    addEventListener: documentTracking.add,
    removeEventListener: documentTracking.remove,
  }

  vi.stubGlobal('addEventListener', windowTracking.add)
  vi.stubGlobal('removeEventListener', windowTracking.remove)
  vi.stubGlobal('document', documentStub)
  stubFetchKeepalive(options.keepaliveSupported)

  return {
    pagehide: () => windowEvents.dispatchEvent(new Event('pagehide')),
    setVisibility: (state: 'visible' | 'hidden') => {
      documentStub.visibilityState = state
      documentEvents.dispatchEvent(new Event('visibilitychange'))
    },
    listenerCount: () => listeners,
  }
}
