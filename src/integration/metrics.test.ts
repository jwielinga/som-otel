import { describe, expect, it } from 'vitest'
import { attributeOf, setupSom as setup } from '../test-support/som.js'

// Every test builds the SDK through createSom and observes it only via the collector.

const DELTA = 1

describe('counter metrics', () => {
  it('sends a counter increment to the derived metrics endpoint', async () => {
    const { som, collector } = setup()

    som.meter.createCounter('checkout.clicks').add(1)
    await som.flush()

    expect(collector.requests.map((request) => request.url)).toEqual([
      'https://collector.example/v1/metrics',
    ])
  })

  it('uses an explicit metricsEndpoint', async () => {
    const { som, collector } = setup({
      metricsEndpoint: 'https://metrics.example/ingest',
    })

    som.meter.createCounter('checkout.clicks').add(1)
    await som.flush()

    expect(collector.requests[0]?.url).toBe('https://metrics.example/ingest')
  })

  it('throws when the metrics endpoint cannot be derived', () => {
    expect(() =>
      setup({ endpoint: 'https://collector.example/ingest' }),
    ).toThrow('tracesEndpoint is required')
    expect(() =>
      setup({
        endpoint: 'https://collector.example/ingest',
        tracesEndpoint: 'https://collector.example/t',
      }),
    ).toThrow('metricsEndpoint is required')
  })

  it('describes a counter as a monotonic delta sum with its metadata', async () => {
    const { som, collector } = setup()

    som.meter
      .createCounter('checkout.clicks', {
        description: 'Checkout button clicks',
        unit: '{click}',
      })
      .add(3)
    await som.flush()

    expect(collector.metrics).toHaveLength(1)
    expect(collector.metrics[0]).toMatchObject({
      name: 'checkout.clicks',
      description: 'Checkout button clicks',
      unit: '{click}',
      sum: { aggregationTemporality: DELTA, isMonotonic: true },
    })
    expect(collector.metrics[0]?.sum?.dataPoints).toMatchObject([
      { asInt: '3' },
    ])
  })

  it('collapses a batch into one data point per attribute set', async () => {
    const { som, collector } = setup({ batch: { maxBatchSize: 10 } })
    const clicks = som.meter.createCounter('checkout.clicks')

    clicks.add(1, { button: 'pay' })
    clicks.add(2, { button: 'pay' })
    clicks.add(5, { button: 'cancel' })
    await som.flush()

    expect(collector.requests).toHaveLength(1)
    const points = collector.metrics[0]?.sum?.dataPoints ?? []
    expect(points).toHaveLength(2)
    expect(
      points.map((point) => [
        attributeOf(point.attributes, 'button'),
        point.asInt,
      ]),
    ).toEqual([
      [{ stringValue: 'pay' }, '3'],
      [{ stringValue: 'cancel' }, '5'],
    ])
  })

  it('treats attribute sets with the same entries as one series', async () => {
    const { som, collector } = setup({ batch: { maxBatchSize: 10 } })
    const clicks = som.meter.createCounter('checkout.clicks')

    clicks.add(1, { a: 1, b: 2 })
    clicks.add(1, { b: 2, a: 1 })
    await som.flush()

    expect(collector.metrics[0]?.sum?.dataPoints).toMatchObject([
      { asInt: '2' },
    ])
  })

  it('sends fractional totals as doubles', async () => {
    const { som, collector } = setup({ batch: { maxBatchSize: 10 } })
    const bytes = som.meter.createCounter('transfer.bytes')

    bytes.add(0.25)
    bytes.add(0.5)
    await som.flush()

    expect(collector.metrics[0]?.sum?.dataPoints).toMatchObject([
      { asDouble: 0.75 },
    ])
  })

  it('spans each data point from its first to its last measurement', async () => {
    const { som, collector } = setup({ batch: { maxBatchSize: 10 } })
    const clicks = som.meter.createCounter('checkout.clicks')

    clicks.add(1)
    clicks.add(1)
    await som.flush()

    const [point] = collector.metrics[0]?.sum?.dataPoints ?? []
    expect(BigInt(point?.startTimeUnixNano ?? '')).toBeLessThanOrEqual(
      BigInt(point?.timeUnixNano ?? ''),
    )
  })

  it('merges two counters created with the same name into one metric', async () => {
    const { som, collector } = setup({ batch: { maxBatchSize: 10 } })

    som.meter.createCounter('x').add(1)
    som.meter.createCounter('x').add(2)
    await som.flush()

    expect(collector.metrics).toHaveLength(1)
    expect(collector.metrics[0]?.sum?.dataPoints).toMatchObject([
      { asInt: '3' },
    ])
  })

  it('keeps separate metrics for separately named counters', async () => {
    const { som, collector } = setup({ batch: { maxBatchSize: 10 } })

    som.meter.createCounter('a').add(1)
    som.meter.createCounter('b').add(1)
    await som.flush()

    expect(collector.metrics.map((metric) => metric.name)).toEqual(['a', 'b'])
  })

  it('carries the resource and scope of the other signals', async () => {
    const { som, collector } = setup({
      scope: { name: 'checkout-ui', version: '2.0.0' },
      resourceAttributes: { 'deployment.environment.name': 'test' },
    })

    som.meter.createCounter('checkout.clicks').add(1)
    await som.flush()

    const [resourceMetrics] =
      collector.requests[0]?.payload.resourceMetrics ?? []
    expect(
      attributeOf(resourceMetrics?.resource.attributes, 'service.name'),
    ).toEqual({
      stringValue: 'checkout',
    })
    expect(resourceMetrics?.scopeMetrics[0]?.scope).toMatchObject({
      name: 'checkout-ui',
      version: '2.0.0',
    })
  })

  it('batches after the size threshold without a flush', async () => {
    const { som, collector } = setup({ batch: { maxBatchSize: 2 } })
    const clicks = som.meter.createCounter('checkout.clicks')

    clicks.add(1)
    clicks.add(1)
    await som.flush()

    expect(collector.requests).toHaveLength(1)
  })

  it('does not throw or send after shutdown', async () => {
    const { som, collector } = setup()
    const clicks = som.meter.createCounter('checkout.clicks')
    await som.shutdown()

    expect(() => clicks.add(1)).not.toThrow()
    await som.flush().catch(() => undefined)

    expect(collector.metrics).toHaveLength(0)
  })

  it('sends pending counters on shutdown', async () => {
    const { som, collector } = setup({ batch: { maxBatchSize: 10 } })

    som.meter.createCounter('checkout.clicks').add(1)
    await som.shutdown()

    expect(collector.metrics).toHaveLength(1)
  })

  it('keeps logs and traces on their own endpoints', async () => {
    const { som, collector } = setup()

    await som.logger.info('hello')
    som.tracer.startSpan('work').end()
    som.meter.createCounter('checkout.clicks').add(1)
    await som.flush()

    expect(collector.requests.map((request) => request.url).sort()).toEqual([
      'https://collector.example/v1/logs',
      'https://collector.example/v1/metrics',
      'https://collector.example/v1/traces',
    ])
  })
})

describe('up-down counter metrics', () => {
  it('sends a non-monotonic delta sum that can go down', async () => {
    const { som, collector } = setup({ batch: { maxBatchSize: 10 } })
    const queue = som.meter.createUpDownCounter('queue.length', {
      unit: '{item}',
    })

    queue.add(5)
    queue.add(-7)
    await som.flush()

    expect(collector.metrics[0]).toMatchObject({
      name: 'queue.length',
      unit: '{item}',
      sum: { aggregationTemporality: DELTA, isMonotonic: false },
    })
    expect(collector.metrics[0]?.sum?.dataPoints).toMatchObject([
      { asInt: '-2' },
    ])
  })
})

describe('gauge metrics', () => {
  it('sends only the last value of a batch per attribute set', async () => {
    const { som, collector } = setup({ batch: { maxBatchSize: 10 } })
    const memory = som.meter.createGauge('memory.used', { unit: 'By' })

    memory.record(10, { tab: 'a' })
    memory.record(30, { tab: 'a' })
    memory.record(20, { tab: 'b' })
    await som.flush()

    expect(collector.metrics).toHaveLength(1)
    expect(collector.metrics[0]?.sum).toBeUndefined()
    const points = collector.metrics[0]?.gauge?.dataPoints ?? []
    expect(
      points.map((point) => [
        attributeOf(point.attributes, 'tab'),
        point.asInt,
      ]),
    ).toEqual([
      [{ stringValue: 'a' }, '30'],
      [{ stringValue: 'b' }, '20'],
    ])
  })

  it('sends fractional values as doubles and omits the start time', async () => {
    const { som, collector } = setup()

    som.meter.createGauge('cpu.load').record(0.75)
    await som.flush()

    const [point] = collector.metrics[0]?.gauge?.dataPoints ?? []
    expect(point).toMatchObject({ asDouble: 0.75 })
    expect(point?.startTimeUnixNano).toBeUndefined()
    expect(point?.timeUnixNano).toMatch(/^\d+$/)
  })
})

describe('instruments of different kinds', () => {
  it('keeps a counter and a gauge with the same name apart', async () => {
    const { som, collector } = setup({ batch: { maxBatchSize: 10 } })

    som.meter.createCounter('x').add(1)
    som.meter.createGauge('x').record(1)
    await som.flush()

    expect(
      collector.metrics.map((metric) => Object.keys(metric).includes('gauge')),
    ).toEqual([false, true])
  })
})

describe('histogram metrics', () => {
  const defaultBounds = [
    0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000,
  ]

  it('sends a delta histogram with the default explicit bounds', async () => {
    const { som, collector } = setup({ batch: { maxBatchSize: 10 } })
    const duration = som.meter.createHistogram('request.duration', {
      unit: 'ms',
    })

    duration.record(3)
    duration.record(5)
    duration.record(120)
    duration.record(20000)
    await som.flush()

    expect(collector.metrics[0]).toMatchObject({
      name: 'request.duration',
      unit: 'ms',
      histogram: { aggregationTemporality: DELTA },
    })
    const [point] = collector.metrics[0]?.histogram?.dataPoints ?? []
    expect(point?.explicitBounds).toEqual(defaultBounds)
    expect(point).toMatchObject({
      count: '4',
      sum: 20128,
      min: 3,
      max: 20000,
    })
    // 3 and 5 share the (0, 5] bucket; 120 falls in (100, 250]; 20000 is past the last bound.
    expect(point?.bucketCounts).toEqual([
      '0',
      '2',
      '0',
      '0',
      '0',
      '0',
      '0',
      '1',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '1',
    ])
  })

  it('puts a value on a bound into the bucket that ends at it', async () => {
    const { som, collector } = setup()

    som.meter.createHistogram('size', { boundaries: [10, 20] }).record(10)
    await som.flush()

    const [point] = collector.metrics[0]?.histogram?.dataPoints ?? []
    expect(point?.explicitBounds).toEqual([10, 20])
    expect(point?.bucketCounts).toEqual(['1', '0', '0'])
  })

  it('sorts custom boundaries and ignores duplicates and non-finite ones', async () => {
    const { som, collector } = setup()

    som.meter
      .createHistogram('size', { boundaries: [20, 10, 10, Infinity, NaN] })
      .record(15)
    await som.flush()

    const [point] = collector.metrics[0]?.histogram?.dataPoints ?? []
    expect(point?.explicitBounds).toEqual([10, 20])
    expect(point?.bucketCounts).toEqual(['0', '1', '0'])
  })

  it('merges a batch into one data point per attribute set', async () => {
    const { som, collector } = setup({ batch: { maxBatchSize: 10 } })
    const duration = som.meter.createHistogram('request.duration')

    duration.record(1, { route: '/a' })
    duration.record(2, { route: '/a' })
    duration.record(9, { route: '/b' })
    await som.flush()

    const points = collector.metrics[0]?.histogram?.dataPoints ?? []
    expect(
      points.map((point) => [
        attributeOf(point.attributes, 'route'),
        point.count,
        point.sum,
      ]),
    ).toEqual([
      [{ stringValue: '/a' }, '2', 3],
      [{ stringValue: '/b' }, '1', 9],
    ])
  })

  it('omits the sum when a negative value was recorded', async () => {
    const { som, collector } = setup({ batch: { maxBatchSize: 10 } })
    const delta = som.meter.createHistogram('delta')

    delta.record(-4)
    delta.record(2)
    await som.flush()

    const [point] = collector.metrics[0]?.histogram?.dataPoints ?? []
    expect(point?.sum).toBeUndefined()
    expect(point).toMatchObject({ count: '2', min: -4, max: 2 })
  })

  it('keeps histograms with different boundaries apart', async () => {
    const { som, collector } = setup({ batch: { maxBatchSize: 10 } })

    som.meter.createHistogram('x', { boundaries: [1] }).record(1)
    som.meter.createHistogram('x', { boundaries: [2] }).record(1)
    await som.flush()

    expect(collector.metrics).toHaveLength(2)
  })
})

describe('invalid measurements', () => {
  function setupWithDiagnostics() {
    const diagnostics: unknown[] = []
    const result = setup({
      batch: { maxBatchSize: 10 },
      onDiagnostic: (event) => diagnostics.push(event),
    })
    return { ...result, diagnostics }
  }

  it('drops a negative counter value and reports it', async () => {
    const { som, collector, diagnostics } = setupWithDiagnostics()

    som.meter.createCounter('checkout.clicks').add(-1)
    await som.flush()

    expect(collector.metrics).toHaveLength(0)
    expect(diagnostics).toEqual([
      {
        type: 'invalid-measurement',
        signal: 'metrics',
        instrument: 'checkout.clicks',
        reason: 'negative-counter-value',
        value: -1,
      },
    ])
  })

  it.each([NaN, Infinity, -Infinity])(
    'drops %s on every instrument and reports it',
    async (value) => {
      const { som, collector, diagnostics } = setupWithDiagnostics()

      som.meter.createCounter('a').add(value)
      som.meter.createUpDownCounter('b').add(value)
      som.meter.createGauge('c').record(value)
      som.meter.createHistogram('d').record(value)
      await som.flush()

      expect(collector.metrics).toHaveLength(0)
      expect(diagnostics).toMatchObject([
        {
          type: 'invalid-measurement',
          instrument: 'a',
          reason: 'non-finite-value',
        },
        {
          type: 'invalid-measurement',
          instrument: 'b',
          reason: 'non-finite-value',
        },
        {
          type: 'invalid-measurement',
          instrument: 'c',
          reason: 'non-finite-value',
        },
        {
          type: 'invalid-measurement',
          instrument: 'd',
          reason: 'non-finite-value',
        },
      ])
    },
  )

  it('still sends valid measurements around an invalid one', async () => {
    const { som, collector } = setupWithDiagnostics()
    const clicks = som.meter.createCounter('checkout.clicks')

    clicks.add(1)
    clicks.add(-5)
    clicks.add(2)
    await som.flush()

    expect(collector.metrics[0]?.sum?.dataPoints).toMatchObject([
      { asInt: '3' },
    ])
  })

  it.each(['counter', 'histogram'] as const)(
    'rejects a non-finite %s aggregate',
    async (kind) => {
      const { som, collector, diagnostics } = setupWithDiagnostics()
      const record =
        kind === 'counter'
          ? (value: number) => som.meter.createCounter('x').add(value)
          : (value: number) => som.meter.createHistogram('x').record(value)

      record(1e308)
      record(1e308)

      await expect(som.flush()).rejects.toThrow(
        'Metric aggregate is not finite',
      )
      expect(collector.requests).toHaveLength(0)
      expect(diagnostics).toContainEqual(
        expect.objectContaining({
          type: 'export-failed',
          signal: 'metrics',
          recordCount: 2,
        }),
      )
    },
  )

  it('accepts negative values where they are meaningful', async () => {
    const { som, collector, diagnostics } = setupWithDiagnostics()

    som.meter.createUpDownCounter('a').add(-1)
    som.meter.createGauge('b').record(-1)
    som.meter.createHistogram('c').record(-1)
    await som.flush()

    expect(diagnostics).toEqual([])
    expect(collector.metrics).toHaveLength(3)
  })

  it('does not throw when the diagnostics callback throws', () => {
    const { som } = setup({
      onDiagnostic: () => {
        throw new Error('boom')
      },
    })

    expect(() => som.meter.createCounter('x').add(-1)).not.toThrow()
  })

  it('reports an attribute that cannot be encoded instead of throwing', async () => {
    const { som, collector, diagnostics } = setupWithDiagnostics()

    expect(() =>
      som.meter.createCounter('x').add(1, { bad: NaN }),
    ).not.toThrow()
    await som.flush()

    expect(collector.metrics).toHaveLength(0)
    expect(diagnostics).toMatchObject([
      { type: 'export-failed', signal: 'metrics' },
    ])
  })
})
