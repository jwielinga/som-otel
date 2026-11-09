import { createSom } from 'som-otel'

export const SERVICE_NAME = 'som-demo'

export const som = createSom({
  // Spans and metrics go to /v1/traces and /v1/metrics next to this URL.
  endpoint:
    import.meta.env.VITE_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/logs',
  serviceName: SERVICE_NAME,
  serviceVersion: '0.1.0',
  resourceAttributes: {
    'deployment.environment.name': import.meta.env.MODE,
  },
  // Demo values for instant feedback; the defaults (20 records, 5s, 3 attempts) suit production.
  batch: { maxBatchSize: 2, scheduledDelayMs: 250 },
  retry: false,
  onDiagnostic: (event) => {
    if (import.meta.env.DEV) console.debug('[som]', event)
  },
})

export const { logger, tracer, meter } = som

export const logsSent = meter.createCounter('demo.logs.sent', {
  description: 'Logs sent from the demo page',
  unit: '{log}',
})

export const sendDuration = meter.createHistogram('demo.log.send.duration', {
  description: 'Time from calling the logger until the export finished',
  unit: 'ms',
})
