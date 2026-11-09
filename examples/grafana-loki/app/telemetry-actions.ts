import {
  buttonClicks,
  logger,
  memoryUsed,
  queueLength,
  saveDuration,
  tracer,
} from './logger'

export type TelemetryAction = {
  id: string
  label: string
  // Returns a short description of what was recorded.
  run: () => string | Promise<string>
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

const between = (min: number, max: number) =>
  Math.round(min + Math.random() * (max - min))

async function traceCheckout(): Promise<string> {
  return tracer.trace('demo.checkout', async (root) => {
    root.setAttribute('cart.items', 3)
    await logger.info(
      'Checkout started',
      { 'demo.action': 'checkout' },
      { span: root },
    )
    await tracer.trace('demo.validate-cart', () => wait(40), { parent: root })
    await tracer.trace(
      'demo.charge-card',
      async (span) => {
        span.addEvent('payment.authorized')
        await wait(120)
      },
      { parent: root, kind: 'client' },
    )
    return `trace ${root.spanContext().traceId}`
  })
}

async function traceFailure(): Promise<string> {
  let traceId = ''
  // trace() records the throw as an exception with error status, then rethrows.
  await tracer
    .trace('demo.save-todo', async (span) => {
      traceId = span.spanContext().traceId
      await wait(60)
      throw new Error('Saving todo failed: disk quota exceeded')
    })
    .catch(() => undefined)
  return `trace ${traceId} (error status)`
}

export const metricActions: TelemetryAction[] = [
  {
    id: 'click',
    label: 'Count a click',
    run: () => {
      buttonClicks.add(1, { button: 'count-click' })
      return 'demo.button.clicks +1'
    },
  },
  {
    id: 'queue-up',
    label: 'Queue +1',
    run: () => {
      queueLength.add(1)
      return 'demo.queue.length +1'
    },
  },
  {
    id: 'queue-down',
    label: 'Queue -1',
    run: () => {
      queueLength.add(-1)
      return 'demo.queue.length -1'
    },
  },
  {
    id: 'memory',
    label: 'Record memory',
    run: () => {
      const megabytes = between(40, 120)
      memoryUsed.record(megabytes * 1_000_000)
      return `demo.memory.used ${megabytes} MB`
    },
  },
  {
    id: 'duration',
    label: 'Record save time',
    run: () => {
      const ms = between(20, 2000)
      saveDuration.record(ms, { outcome: 'ok' })
      return `demo.todo.save.duration ${ms} ms`
    },
  },
]

export const traceActions: TelemetryAction[] = [
  {
    id: 'trace-checkout',
    label: 'Trace a checkout',
    run: traceCheckout,
  },
  {
    id: 'trace-failure',
    label: 'Trace a failure',
    run: traceFailure,
  },
]
