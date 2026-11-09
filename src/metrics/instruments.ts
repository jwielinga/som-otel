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
