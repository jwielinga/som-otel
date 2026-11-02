---
sidebar_position: 11
title: Attribute limits
---

# Attribute limits

Limits keep one careless log call from producing a huge request. They apply to the attributes of every record you log.

```ts
const logger = createSomLogger({
  endpoint: 'https://collector.example.com/v1/logs',
  serviceName: 'storefront',
  limits: {
    attributeCountLimit: 128,
    attributeValueLengthLimit: 4096,
    maxValueDepth: 20,
  },
})
```

| Option                      | Default    | What happens when exceeded                                              |
| --------------------------- | ---------- | ----------------------------------------------------------------------- |
| `attributeCountLimit`       | `128`      | Extra attributes are dropped and counted in `droppedAttributesCount`.   |
| `attributeValueLengthLimit` | `Infinity` | Longer string values are truncated.                                     |
| `maxValueDepth`             | `20`       | Values nested deeper are replaced with the string `[MaxDepthExceeded]`. |

## Attribute count

Attributes are kept in the order you wrote them. Once `attributeCountLimit` is reached the rest are dropped, and the record's `droppedAttributesCount` is the number dropped. For `logRecord()`, Som adds this to any `droppedAttributesCount` you passed.

## String length

`attributeValueLengthLimit` truncates string attribute values, including strings inside arrays and nested maps and the `exception.stacktrace` of a logged `Error`. It never splits a surrogate pair, so an emoji is dropped whole instead of becoming a broken character.

The **body** is not truncated.

## Depth and circular references

Nested objects and arrays count toward `maxValueDepth`. Beyond it, the value is replaced with `[MaxDepthExceeded]`. A reference back to an object that is already being encoded is replaced with `[Circular]`. The same object appearing twice in different places is fine; only true cycles are replaced.

## Spans

With `createSom()`, the same limits apply to span attributes, and to the attributes of each span event and link. Two more limits are specific to spans:

| Option            | Default | What happens when exceeded                                    |
| ----------------- | ------- | ------------------------------------------------------------- |
| `eventCountLimit` | `128`   | Extra events are dropped and counted in `droppedEventsCount`. |
| `linkCountLimit`  | `128`   | Extra links are dropped and counted in `droppedLinksCount`.   |

Setting an attribute that already exists never counts against the limit. See [Tracing](./tracing.md#limits).

```ts
const user: Record<string, unknown> = { name: 'Ada' }
user.self = user

await logger.info('Profile loaded', { user }) // user.self → '[Circular]'
```

## Resource and scope attributes

Limits apply to **log attributes** only. Resource and scope attributes are yours to set and are not counted or truncated, except for the depth guard.
