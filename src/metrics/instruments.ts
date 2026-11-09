import type { MetricAttributes, Recorder } from '../types.js'

// Shared by every instrument: forwards each call to the meter.
class Instrument {
  protected readonly recorder: Recorder

  constructor(recorder: Recorder) {
    this.recorder = recorder
  }
}

// Only ever increases; negative values are not valid.
export class Counter extends Instrument {
  add(value: number, attributes?: MetricAttributes): void {
    this.recorder(value, attributes)
  }
}

// Goes up and down, for example the length of a queue.
export class UpDownCounter extends Instrument {
  add(value: number, attributes?: MetricAttributes): void {
    this.recorder(value, attributes)
  }
}

// A current value, for example memory in use; a batch keeps only the last one.
export class Gauge extends Instrument {
  record(value: number, attributes?: MetricAttributes): void {
    this.recorder(value, attributes)
  }
}

// A distribution of values, for example request durations.
export class Histogram extends Instrument {
  record(value: number, attributes?: MetricAttributes): void {
    this.recorder(value, attributes)
  }
}
