import type { LogBatcher } from '../transport/batcher.js'
import { createOtlpMeasurement } from '../otlp/encode-metrics.js'
import { DEFAULT_LIMITS } from '../otlp/otlp.constants.js'
import type {
  InstrumentOptions,
  MetricAttributes,
  MetricDescriptor,
  OtlpLimits,
  OtlpMeasurement,
  SomMeterInit,
} from '../types.js'
import { Counter } from './instruments.js'

export class SomMeter {
  private readonly batcher: LogBatcher<OtlpMeasurement>
  private readonly limits: OtlpLimits
  private readonly onError: ((error: unknown) => void) | undefined
  private readonly onShutdown: (() => void) | undefined
  private isShutdown = false

  constructor(
    batcher: LogBatcher<OtlpMeasurement>,
    options: SomMeterInit = {},
  ) {
    this.batcher = batcher
    this.limits = options.limits ?? DEFAULT_LIMITS
    this.onError = options.onError
    this.onShutdown = options.onShutdown
  }

  // Measurements dropped because the pending queue was full.
  get droppedMeasurementCount(): number {
    return this.batcher.droppedCount
  }

  createCounter(name: string, options: InstrumentOptions = {}): Counter {
    const descriptor: MetricDescriptor = { ...options, name, kind: 'counter' }
    return new Counter((value, attributes) =>
      this.measure(descriptor, value, attributes),
    )
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

    let measurement: OtlpMeasurement
    try {
      measurement = createOtlpMeasurement(
        descriptor,
        value,
        attributes,
        this.limits,
      )
    } catch (error) {
      this.onError?.(error)
      return
    }
    void this.batcher.add(measurement).catch(() => undefined)
  }
}
