import { collectFailures, throwFailures } from '../utils/failures.js'
import type { SomLogger } from '../logs/logger.js'
import type { SomMeter } from '../metrics/meter.js'
import type { SomTracer } from '../traces/tracer.js'

// Waits for every task, then reports all failures.
async function settleAll(
  tasks: Array<Promise<void>>,
  message: string,
): Promise<void> {
  throwFailures(collectFailures(await Promise.allSettled(tasks)), message)
}

export class Som {
  readonly logger: SomLogger
  readonly tracer: SomTracer
  readonly meter: SomMeter
  private readonly removePageListeners: () => void

  constructor(
    logger: SomLogger,
    tracer: SomTracer,
    meter: SomMeter,
    removePageListeners: () => void,
  ) {
    this.logger = logger
    this.tracer = tracer
    this.meter = meter
    this.removePageListeners = removePageListeners
  }

  flush(): Promise<void> {
    return settleAll(
      [this.logger.flush(), this.tracer.flush(), this.meter.flush()],
      'Flushing logs, traces and metrics failed.',
    )
  }

  shutdown(): Promise<void> {
    this.removePageListeners()
    return settleAll(
      [this.logger.shutdown(), this.tracer.shutdown(), this.meter.shutdown()],
      'Shutting down logs, traces and metrics failed.',
    )
  }
}
