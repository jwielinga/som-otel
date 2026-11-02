import { createSom } from '../core/sdk.js'
import type { SomOptions } from '../types.js'
import { FakeCollector } from './fake-collector.js'

// One-span batches and no resource detection, so each test sees exactly what it sends.
export function setupSom(options: Partial<SomOptions> = {}) {
  const collector = new FakeCollector()
  const som = createSom({
    endpoint: 'https://collector.example/v1/logs',
    serviceName: 'checkout',
    fetcher: collector.fetcher,
    batch: { maxBatchSize: 1 },
    detectResource: false,
    retry: { initialDelayMs: 1, maxDelayMs: 5 },
    ...options,
  })
  return { som, collector }
}

export function attributeOf(
  attributes: Array<{ key: string; value?: unknown }> | undefined,
  key: string,
): unknown {
  return attributes?.find((entry) => entry.key === key)?.value
}
