import type { LogBatcher } from '../transport/batcher.js'
import { createOtlpMeasurement, metricKey } from '../otlp/encode-metrics.js'
import { DEFAULT_LIMITS } from '../otlp/otlp.constants.js'
import type {
  Emit,
  HistogramOptions,
  InstrumentOptions,
  MetricAttributes,
  MetricDescriptor,
  OtlpLimits,
  OtlpMeasurement,
  Recorder,
  SomMeterInit,
} from '../types.js'
import { Counter, Gauge, Histogram, UpDownCounter } from './instruments.js'
import { DEFAULT_HISTOGRAM_BOUNDARIES } from './metrics.constants.js'
import { SeriesClock } from './series-clock.js'

function invalidReason(
  descriptor: MetricDescriptor,
  value: number,
): 'negative-counter-value' | 'non-finite-value' | undefined {
  if (!Number.isFinite(value)) return 'non-finite-value'
  if (descriptor.kind === 'counter' && value < 0) {
    return 'negative-counter-value'
  }
  return undefined
}

// Bounds must be ascending and finite; anything else is dropped rather than rejected.
function normalizeBoundaries(
  boundaries: readonly number[] = DEFAULT_HISTOGRAM_BOUNDARIES,
): number[] {
  return [...new Set(boundaries.filter(Number.isFinite))].sort((a, b) => a - b)
}

function sameBoundaries(
  a: readonly number[] = [],
  b: readonly number[] = [],
): boolean {
  return a.length === b.length && a.every((bound, index) => bound === b[index])
}

// TODO(metrics): observable instruments, views, and a metrics-only factory are not supported yet.
export class SomMeter {
  private readonly batcher: LogBatcher<OtlpMeasurement>
  private readonly limits: OtlpLimits
  private readonly emit: Emit | undefined
  private readonly onShutdown: (() => void) | undefined
  private readonly clock = new SeriesClock()
  // The first instrument of a kind, name and unit defines the metric for all of them.
  private readonly descriptors = new Map<string, MetricDescriptor>()
  private isShutdown = false

  constructor(
    batcher: LogBatcher<OtlpMeasurement>,
    options: SomMeterInit = {},
  ) {
    this.batcher = batcher
    this.limits = options.limits ?? DEFAULT_LIMITS
    this.emit = options.emit
    this.onShutdown = options.onShutdown
  }

  // Measurements dropped because the pending queue was full.
  get droppedMeasurementCount(): number {
    return this.batcher.droppedCount
  }

  createCounter(name: string, options: InstrumentOptions = {}): Counter {
    return new Counter(this.recorder({ ...options, name, kind: 'counter' }))
  }

  createUpDownCounter(
    name: string,
    options: InstrumentOptions = {},
  ): UpDownCounter {
    return new UpDownCounter(
      this.recorder({ ...options, name, kind: 'up-down-counter' }),
    )
  }

  createGauge(name: string, options: InstrumentOptions = {}): Gauge {
    return new Gauge(this.recorder({ ...options, name, kind: 'gauge' }))
  }

  createHistogram(name: string, options: HistogramOptions = {}): Histogram {
    const { boundaries, ...rest } = options
    return new Histogram(
      this.recorder({
        ...rest,
        name,
        kind: 'histogram',
        boundaries: normalizeBoundaries(boundaries),
      }),
    )
  }

  private recorder(requested: MetricDescriptor): Recorder {
    const descriptor = this.register(requested)
    return (value, attributes) => this.measure(descriptor, value, attributes)
  }

  private register(requested: MetricDescriptor): MetricDescriptor {
    const key = metricKey(requested)
    const known = this.descriptors.get(key)
    if (known === undefined) {
      this.descriptors.set(key, requested)
      return requested
    }

    if (!sameBoundaries(known.boundaries, requested.boundaries)) {
      this.emit?.({
        type: 'instrument-conflict',
        signal: 'metrics',
        instrument: requested.name,
        reason: 'boundaries-differ',
      })
    }
    return known
  }

  flush(): Promise<void> {
    return this.batcher.flush()
  }

  shutdown(): Promise<void> {
    this.isShutdown = true
    this.onShutdown?.()
    return this.batcher.shutdown()
  }

  // Failures surface through onDiagnostic and flush(), so the per-measurement promise is dropped.
  private measure(
    descriptor: MetricDescriptor,
    value: number,
    attributes: MetricAttributes = {},
  ): void {
    if (this.isShutdown) return

    const invalid = invalidReason(descriptor, value)
    if (invalid !== undefined) {
      this.emit?.({
        type: 'invalid-measurement',
        signal: 'metrics',
        instrument: descriptor.name,
        reason: invalid,
        value,
      })
      return
    }

    let measurement: OtlpMeasurement
    try {
      measurement = createOtlpMeasurement(
        descriptor,
        value,
        attributes,
        this.clock,
        this.limits,
      )
    } catch (error) {
      this.emit?.({
        type: 'export-failed',
        signal: 'metrics',
        error,
        recordCount: 1,
      })
      return
    }
    void this.batcher.add(measurement).catch(() => undefined)
  }
}
