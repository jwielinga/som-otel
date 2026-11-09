import type { MetricAttributes } from '../types.js'

export type Recorder = (value: number, attributes?: MetricAttributes) => void

// Only ever increases; negative values are not valid.
export class Counter {
  private readonly record: Recorder

  constructor(record: Recorder) {
    this.record = record
  }

  add(value: number, attributes?: MetricAttributes): void {
    this.record(value, attributes)
  }
}

// Goes up and down, for example the length of a queue.
export class UpDownCounter {
  private readonly recorder: Recorder

  constructor(recorder: Recorder) {
    this.recorder = recorder
  }

  add(value: number, attributes?: MetricAttributes): void {
    this.recorder(value, attributes)
  }
}

// A current value, for example memory in use; a batch keeps only the last one.
export class Gauge {
  private readonly recorder: Recorder

  constructor(recorder: Recorder) {
    this.recorder = recorder
  }

  record(value: number, attributes?: MetricAttributes): void {
    this.recorder(value, attributes)
  }
}

// A distribution of values, for example request durations.
export class Histogram {
  private readonly recorder: Recorder

  constructor(recorder: Recorder) {
    this.recorder = recorder
  }

  record(value: number, attributes?: MetricAttributes): void {
    this.recorder(value, attributes)
  }
}
