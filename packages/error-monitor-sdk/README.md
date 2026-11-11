# @commerce-ext/error-monitor-sdk

Record sanitized errors from Adobe App Builder actions to the Commerce Error Monitor. Zero dependencies, Node ≥ 18.

```js
const { withErrorMonitor, createErrorMonitor } = require('@commerce-ext/error-monitor-sdk');

// 1) Wrap an action: unhandled errors are recorded; caller receives a generic 500 + errorId.
exports.main = withErrorMonitor(handler, { source: { app: 'my-app', action: 'sync', version: '1.2.0', environment: 'stage' } });

// 2) Or record explicitly (never throws):
const monitor = createErrorMonitor({ endpoint, signingKey, source: { app: 'my-app' } });
await monitor.record(err, { severity: 'warning', context: { requestId, http: { method: 'POST', path: '/hook', status: 502 }, tags: { region: 'emea' } } });
```

| Export | Purpose |
|---|---|
| `withErrorMonitor(handler, { source, resolveOptions?, fetchImpl? })` | Wrap `main`. Reads `ERROR_MONITOR_ENDPOINT` / `ERROR_MONITOR_SIGNING_KEY` from action params unless `resolveOptions(params)` is given. |
| `createErrorMonitor({ endpoint, signingKey, source, timeoutMs=2000, throttle, fetchImpl, onTransportError })` | `.record(error, { severity, context, source, timestamp }) → { recorded, id? , reason? }` |
| `normalizePayload`, `validateRecord`, `sanitizeText`, `sign`, `verifySignature` | Used by the monitor itself; exported for tests/tools. |
| `@commerce-ext/error-monitor-sdk/schema.json` | JSON Schema of the stored `ErrorRecord` v1. |

**Safety properties**: `https` endpoint required (plain `http` only for `localhost` with `allowInsecureLocalhost`); 2 s timeout; no redirects;
per-fingerprint throttle (5 / minute / warm container); payload capped at 64 KB; only allow-listed `context` fields (`requestId`, `activationId`,
`http{method,path,status}`, `tags`) are sent – request bodies and headers are never accepted. Secrets / PII in free text are masked before sending;
the server masks again.
