import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSomLogger } from './sdk.js'
import { OTelSeverityNumber } from '../otlp/otlp.constants.js'
import type { SomLoggerOptions } from '../types.js'
import { FakeCollector } from '../test-support/fake-collector.js'
import { stubFetchKeepalive } from '../test-support/keepalive.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function setup(options: Partial<SomLoggerOptions> = {}) {
  const collector = new FakeCollector()
  const logger = createSomLogger({
    endpoint: 'https://collector.example/v1/logs',
    serviceName: 'checkout',
    fetcher: collector.fetcher,
    batch: { maxBatchSize: 1 },
    detectResource: false,
    ...options,
  })
  return { logger, collector }
}

const slowBatch = { maxBatchSize: 10, scheduledDelayMs: 60_000 }

describe('SDK factory', () => {
  it('creates logger that exports OTel fields and merged resource attributes', async () => {
    const { logger, collector } = setup({
      serviceVersion: '1.2.3',
      resourceAttributes: {
        'deployment.environment.name': 'test',
        'service.name': 'overridden',
      },
    })

    await logger.logRecord({
      severityNumber: OTelSeverityNumber.INFO,
      severityText: 'INFO',
      body: { message: 'checkout complete', orderId: 'order-42' },
      traceId: '5B8EFFF798038103D269B633813FC60C',
      spanId: 'EEE19B7EC3C1B174',
      eventName: 'checkout.completed',
    })

    expect(collector.requests[0]?.payload).toMatchObject({
      resourceLogs: [
        {
          resource: {
            attributes: [
              {
                key: 'deployment.environment.name',
                value: { stringValue: 'test' },
              },
              { key: 'service.name', value: { stringValue: 'checkout' } },
              { key: 'service.version', value: { stringValue: '1.2.3' } },
            ],
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  severityNumber: OTelSeverityNumber.INFO,
                  severityText: 'INFO',
                  body: {
                    kvlistValue: {
                      values: [
                        {
                          key: 'message',
                          value: { stringValue: 'checkout complete' },
                        },
                        { key: 'orderId', value: { stringValue: 'order-42' } },
                      ],
                    },
                  },
                  traceId: '5B8EFFF798038103D269B633813FC60C',
                  spanId: 'EEE19B7EC3C1B174',
                  eventName: 'checkout.completed',
                },
              ],
            },
          ],
        },
      ],
    })
  })

  it('batches application logs using configured thresholds', async () => {
    const { logger, collector } = setup({
      batch: { maxBatchSize: 2, scheduledDelayMs: 60_000 },
    })
    const first = logger.info('checkout started')
    const second = logger.error('payment failed')

    await Promise.all([first, second])

    expect(collector.requests).toHaveLength(1)
    expect(collector.bodies).toEqual(['checkout started', 'payment failed'])
  })

  it('rejects instead of throwing for values that cannot be encoded', async () => {
    const { logger } = setup()

    await expect(logger.info('bad', { ratio: Number.NaN })).rejects.toThrow(
      'Log attribute "ratio" must be a finite number.',
    )
    await expect(logger.logRecord({ body: 2n ** 63n })).rejects.toThrow(
      'Log attribute "body" must fit in a signed int64.',
    )
  })

  it('keeps working after an encoding failure', async () => {
    const { logger } = setup()

    await expect(logger.info('bad', { ratio: Infinity })).rejects.toThrow()
    await expect(logger.info('good')).resolves.toBeUndefined()
  })

  it('queues a log synchronously so an immediate flush sends it', async () => {
    const { logger, collector } = setup({ batch: slowBatch })

    const pending = logger.info('queued')
    await logger.flush()
    await pending

    expect(collector.bodies).toEqual(['queued'])
  })

  it('sends a log made just before shutdown', async () => {
    const { logger, collector } = setup({ batch: slowBatch })

    const pending = logger.info('last words')
    await logger.shutdown()
    await expect(pending).resolves.toBeUndefined()

    expect(collector.bodies).toEqual(['last words'])
  })

  it('fails fast when no fetch implementation is available', () => {
    vi.stubGlobal('fetch', undefined)

    expect(() =>
      createSomLogger({ endpoint: '/v1/logs', serviceName: 'checkout' }),
    ).toThrow('fetch is not available in this environment')
  })

  describe('keepalive', () => {
    async function sentWithKeepalive(
      options: Partial<SomLoggerOptions>,
    ): Promise<boolean | undefined> {
      const { logger, collector } = setup(options)
      await logger.info('unload test')
      return collector.requests[0]?.keepalive
    }

    it('is enabled by default when the browser supports it', async () => {
      stubFetchKeepalive(true)

      expect(await sentWithKeepalive({})).toBe(true)
    })

    it('can be disabled', async () => {
      stubFetchKeepalive(true)

      expect(await sentWithKeepalive({ keepalive: false })).toBe(false)
    })

    it('is skipped in browsers without keepalive support', async () => {
      stubFetchKeepalive(false)

      expect(await sentWithKeepalive({})).toBe(false)
    })
  })
})
