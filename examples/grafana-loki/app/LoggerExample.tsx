import { ChevronDown } from 'lucide-react'

const example = `import { createSom, OTelSeverityNumber } from 'som-otel'

// Spans go to /v1/traces and metrics to /v1/metrics next to the logs URL.
const { logger, tracer, meter } = createSom({
  endpoint: 'http://localhost:4318/v1/logs',
  serviceName: 'som-demo',
})

// Every call returns a promise: it resolves once the batch is exported
// and rejects if the export fails, so await it or add .catch().
await logger.debug('Rendered TodoList with 3 items', {
  'component.name': 'TodoList',
})

await logger.info('Todo added: Buy milk', {
  'todo.title': 'Buy milk',
})

await logger.warn('Saving todos is taking longer than expected', {
  duration_ms: 1830,
})

await logger.error('Failed to save todo', {
  'todo.id': 'todo-42',
  'error.code': 'NETWORK_ERROR',
})

// Pass an Error as the body to get exception.type, exception.message and the stack.
try {
  JSON.parse(savedTodos)
} catch (error) {
  await logger.error(error as Error, { 'demo.action': 'todo.load' })
}

// Som has no logger.fatal(). Send the OTel FATAL severity with logRecord().
await logger.logRecord({
  severityNumber: OTelSeverityNumber.FATAL,
  severityText: 'FATAL',
  body: 'TodoList crashed: Cannot read properties of undefined',
  attributes: { 'component.name': 'TodoList' },
})

// Wrap work in a span and link logs to it with the span option.
const span = tracer.startSpan('demo.send-log')
await logger.info('Inside the span', {}, { span })
span.end()

// Metrics: every call is queued and sent as delta data points.
const sent = meter.createCounter('demo.logs.sent', { unit: '{log}' })
sent.add(1, { severity: 'info' })

const duration = meter.createHistogram('demo.log.send.duration', { unit: 'ms' })
duration.record(42, { severity: 'info' })`

export function LoggerExample() {
  return (
    <details className="usage group">
      <summary>
        <span className="usage-title">How to use the logger</span>
        <span className="usage-hint">message + optional attributes</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 transition-transform group-open:rotate-180"
        />
      </summary>
      <pre>
        <code>{example}</code>
      </pre>
    </details>
  )
}
