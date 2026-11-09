# Som

Som sends OpenTelemetry telemetry from a browser app to an OTLP/HTTP collector. It exists to help developers debug sessions of their own web app.

## Language

**Signal**:
A kind of telemetry Som sends: logs, traces, or metrics. Each signal has its own queue and its own collector URL.
_Avoid_: Stream, channel, pipeline

**Log record**:
One timestamped entry written by the app, with a severity, a body, and attributes.
_Avoid_: Log line, event (an event is a log record with an event name)

**Span**:
One timed operation within a trace, started and ended by the app, with attributes, events, links, and a status.
_Avoid_: Segment, transaction

**Trace**:
The set of spans that share one trace id and together describe one operation across the app.
_Avoid_: Session, request

**Trace context**:
The trace id, span id, and trace flags that identify a place in a trace, used to continue a trace or to correlate a log record with a span.
_Avoid_: Trace headers, correlation id

**Metric**:
A named measurement of the app over time, sent to the collector as data points.
_Avoid_: Stat, counter (as a generic word)

**Instrument**:
The object the app calls to record measurements for one metric.
_Avoid_: Meter (the meter is what creates instruments)

**Data point**:
One timestamped value recorded for a metric by a single call on an instrument, with attributes.
_Avoid_: Sample, measurement, reading

**Collector**:
The server that receives what Som sends over OTLP/HTTP.
_Avoid_: Backend, endpoint (an endpoint is a collector URL)

**Batch**:
The log records or spans of one signal that are sent to the collector in a single request.
_Avoid_: Chunk, bundle

**Resource**:
The attributes that describe the app sending the telemetry, shared by every log record and span.
_Avoid_: Service, metadata

**Scope**:
The name and version of the instrumentation that produced the telemetry.
_Avoid_: Library, logger name
