import type { SomLogger } from './logger.js'
import type { SomTracer } from './tracer.js'

// Settles every task, then reports the failures: one as is, several as an AggregateError.
async function settleAll(
  tasks: Array<Promise<void>>,
  message: string,
): Promise<void> {
  const failures = (await Promise.allSettled(tasks)).flatMap((result) =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  )

  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, message)
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
