import { collectFailures, throwFailures } from '../utils/failures.js'
import type { SomLogger } from '../logs/logger.js'
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
  private readonly removePageListeners: () => void

  constructor(
    logger: SomLogger,
    tracer: SomTracer,
    removePageListeners: () => void,
  ) {
    this.logger = logger
    this.tracer = tracer
    this.removePageListeners = removePageListeners
  }

  flush(): Promise<void> {
    return settleAll(
      [this.logger.flush(), this.tracer.flush()],
      'Flushing logs and traces failed.',
    )
  }

  shutdown(): Promise<void> {
    this.removePageListeners()
    return settleAll(
      [this.logger.shutdown(), this.tracer.shutdown()],
      'Shutting down logs and traces failed.',
    )
  }
}
