/// <reference types="node" />
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

// A real OpenTelemetry Collector in Docker. Som sends to its OTLP/HTTP receiver; the collector
// parses the request (so a malformed one is rejected) and forwards it as JSON to a local sink.

const run = promisify(execFile)

// Override with SOM_COLLECTOR_IMAGE to test another collector version.
export const COLLECTOR_IMAGE =
  process.env.SOM_COLLECTOR_IMAGE ?? 'otel/opentelemetry-collector:0.140.0'

const RECEIVER_PORT = 4318

export type ForwardedExport = { path: string; body: unknown }

export type RunningCollector = {
  // Base URL of the collector's OTLP/HTTP receiver, for example http://127.0.0.1:49152.
  url: string
  forwarded: ForwardedExport[]
  waitFor(
    predicate: (forwarded: ForwardedExport[]) => boolean,
    timeoutMs?: number,
  ): Promise<void>
  logs(): Promise<string>
  stop(): Promise<void>
}

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await run('docker', ['info'], { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

function collectorConfig(sinkPort: number): string {
  return `
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:${RECEIVER_PORT}

exporters:
  otlphttp:
    endpoint: http://host.docker.internal:${sinkPort}
    encoding: json
    compression: none
    retry_on_failure:
      enabled: false
    sending_queue:
      enabled: false

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlphttp]
    logs:
      receivers: [otlp]
      exporters: [otlphttp]
    metrics:
      receivers: [otlp]
      exporters: [otlphttp]
`
}

function startSink(forwarded: ForwardedExport[]): Promise<Server> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      forwarded.push({
        path: request.url ?? '',
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
      })
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end('{}')
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '0.0.0.0', () => resolve(server))
  })
}

async function waitUntilReceiving(url: string): Promise<void> {
  const deadline = Date.now() + 30_000
  for (;;) {
    try {
      const response = await fetch(`${url}/v1/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"resourceSpans":[]}',
      })
      if (response.ok) return
    } catch {
      // The receiver is not listening yet.
    }
    if (Date.now() > deadline) {
      throw new Error('The collector did not start receiving within 30s.')
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

export async function startCollector(): Promise<RunningCollector> {
  const forwarded: ForwardedExport[] = []
  const sink = await startSink(forwarded)
  const directory = await mkdtemp(join(tmpdir(), 'som-collector-'))
  const configPath = join(directory, 'config.yaml')
  await writeFile(
    configPath,
    collectorConfig((sink.address() as AddressInfo).port),
    { mode: 0o644 },
  )

  const { stdout } = await run('docker', [
    'run',
    '--detach',
    '--rm',
    '--add-host=host.docker.internal:host-gateway',
    '--publish',
    `127.0.0.1::${RECEIVER_PORT}`,
    '--volume',
    `${configPath}:/etc/otelcol/config.yaml:ro`,
    COLLECTOR_IMAGE,
    '--config=/etc/otelcol/config.yaml',
  ])
  const container = stdout.trim()

  const stop = async (): Promise<void> => {
    await run('docker', ['rm', '--force', container]).catch(() => undefined)
    sink.close()
    await rm(directory, { recursive: true, force: true })
  }

  try {
    const { stdout: mapping } = await run('docker', [
      'port',
      container,
      `${RECEIVER_PORT}/tcp`,
    ])
    const port = mapping.trim().split('\n')[0]?.split(':').pop()
    const url = `http://127.0.0.1:${port}`
    await waitUntilReceiving(url)
    forwarded.length = 0

    return {
      url,
      forwarded,
      stop,
      logs: async () => (await run('docker', ['logs', container])).stderr,
      waitFor: async (predicate, timeoutMs = 10_000) => {
        const deadline = Date.now() + timeoutMs
        while (!predicate(forwarded)) {
          if (Date.now() > deadline) {
            throw new Error(
              `The collector did not forward the expected data within ${timeoutMs}ms.`,
            )
          }
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      },
    }
  } catch (error) {
    await stop()
    throw error
  }
}
