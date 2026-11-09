import type { LogBatcher } from '../transport/batcher.js'
import { createOtlpMeasurement } from '../otlp/encode-metrics.js'
import { DEFAULT_LIMITS } from '../otlp/otlp.constants.js'
import type {
  Emit,
  HistogramOptions,
  InstrumentOptions,
  MetricAttributes,
  MetricDescriptor,
  OtlpLimits,
  OtlpMeasurement,
  SomMeterInit,
} from '../types.js'
import { Counter, Gauge, Histogram, UpDownCounter } from './instruments.js'
import type { Recorder } from './instruments.js'
import { DEFAULT_HISTOGRAM_BOUNDARIES } from './metrics.constants.js'

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

// TODO(metrics): observable instruments, views, and a metrics-only factory are not supported yet.
export class SomMeter {
  private readonly batcher: LogBatcher<OtlpMeasurement>
  private readonly limits: OtlpLimits
  private readonly emit: Emit | undefined
  private readonly onShutdown: (() => void) | undefined
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

  private recorder(descriptor: MetricDescriptor): Recorder {
    return (value, attributes) => this.measure(descriptor, value, attributes)
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
