import { afterEach, describe, expect, it, vi } from 'vitest'
import { isFetchKeepaliveSupported } from './http-exporter.js'
import type { OtlpLogRecord } from '../types.js'
import {
  createExporter,
  record,
  sequenceFetcher,
} from '../test-support/exporter.js'
import { stubFetchKeepalive } from '../test-support/keepalive.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OtlpHttpExporter', () => {
  it('posts OTLP JSON with configured headers and resource attributes', async () => {
    const urls: unknown[] = []
    const { calls, fetcher } = sequenceFetcher()
    const exporter = createExporter({
      endpoint: 'https://collector.example/v1/logs',
      headers: { Authorization: 'Bearer test-token' },
      fetcher: (input, init) => {
        urls.push(input)
        return fetcher(input, init)
      },
    })

    await exporter.export([record])

    expect(urls).toEqual(['https://collector.example/v1/logs'])
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    })
    expect(JSON.parse(String(calls[0]?.body))).toMatchObject({
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'checkout' } },
            ],
          },
          scopeLogs: [{ logRecords: [record] }],
        },
      ],
    })
  })

  it('rejects non-successful collector responses', async () => {
    const { fetcher } = sequenceFetcher([
      new Response(null, { status: 503, statusText: 'Unavailable' }),
    ])

    await expect(createExporter({ fetcher }).export([record])).rejects.toThrow(
      'OTLP log request failed: 503 Unavailable',
    )
  })

  it('converts synchronous fetcher errors to promise rejections', async () => {
    const exporter = createExporter({
      fetcher: () => {
        throw new Error('fetcher failed synchronously')
      },
    })

    await expect(exporter.export([record])).rejects.toThrow(
      'fetcher failed synchronously',
    )
  })

  it('calls the fetcher without the exporter as receiver', async () => {
    // Browser fetch throws "Illegal invocation" when called as a method.
    const exporter = createExporter({
      fetcher: function (this: unknown) {
        if (this !== undefined && this !== globalThis) {
          throw new TypeError('Illegal invocation')
        }
        return Promise.resolve(new Response(null, { status: 204 }))
      } as typeof fetch,
    })

    await expect(exporter.export([record])).resolves.toBeUndefined()
  })

  describe('keepalive', () => {
    async function exportOne(
      keepalive: boolean | undefined,
      exported: OtlpLogRecord = record,
    ): Promise<RequestInit | undefined> {
      const { calls, fetcher } = sequenceFetcher()
      await createExporter({ fetcher, keepalive }).export([exported])
      return calls[0]
    }

    it('sets fetch keepalive when enabled', async () => {
      expect((await exportOne(true))?.keepalive).toBe(true)
    })

    it.each([false, undefined])(
      'omits keepalive when %s',
      async (keepalive) => {
        expect(await exportOne(keepalive)).not.toHaveProperty('keepalive')
      },
    )

    it('never sends a Connection header', async () => {
      expect((await exportOne(true))?.headers).not.toHaveProperty('Connection')
    })

    it('omits keepalive when the body exceeds the browser limit', async () => {
      const large: OtlpLogRecord = {
        ...record,
        body: { stringValue: 'x'.repeat(70 * 1024) },
      }

      expect(await exportOne(true, large)).not.toHaveProperty('keepalive')
    })
  })

  describe('isFetchKeepaliveSupported', () => {
    it('is false when Request lacks keepalive', () => {
      stubFetchKeepalive(false)

      expect(isFetchKeepaliveSupported()).toBe(false)
    })

    it('is false when Request is undefined', () => {
      vi.stubGlobal('Request', undefined)

      expect(isFetchKeepaliveSupported()).toBe(false)
    })

    it('is true when Request exposes keepalive', () => {
      stubFetchKeepalive(true)

      expect(isFetchKeepaliveSupported()).toBe(true)
    })
  })
})
