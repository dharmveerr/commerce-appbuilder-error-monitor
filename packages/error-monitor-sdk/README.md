# @commerce-ext/error-monitor-sdk

Record sanitized errors from Adobe App Builder actions (normal actions, event handlers and Commerce webhooks) to the Commerce Error Monitor.
Zero dependencies. Node.js 20 or later.

> Full step-by-step guide, including how to publish a new version: [`docs/using-the-sdk-in-your-project.md`](../../docs/using-the-sdk-in-your-project.md).

## Quick start (in your App Builder project)

**1. Install** in your project's root folder (where `package.json` and `app.config.yaml` are). The package is distributed as a file attached to a **GitHub Release** of the Error Monitor repository:
```bash
npm install https://github.com/<github-org>/<repository>/releases/download/sdk-v0.1.0/commerce-ext-error-monitor-sdk-0.1.0.tgz
```
For a newer version, use its link on the repository's **Releases** page. For private repositories, see the [usage guide](../../docs/using-the-sdk-in-your-project.md#2-distributing-the-package).

**2. Add two settings** to your project's `.env` (never commit it):
```
ERROR_MONITOR_ENDPOINT=<URL of the Error Monitor's record-error action>
ERROR_MONITOR_SIGNING_KEY=<the Error Monitor's INGEST_SIGNING_KEY>
```

**3. Pass them to each action** in `app.config.yaml` (or `ext.config.yaml`):
```yaml
inputs:
  ERROR_MONITOR_ENDPOINT: $ERROR_MONITOR_ENDPOINT
  ERROR_MONITOR_SIGNING_KEY: $ERROR_MONITOR_SIGNING_KEY
```

**4. Wrap the action.** Change only the export line.

A normal action or an event handler:
```js
const { withErrorMonitor } = require('@commerce-ext/error-monitor-sdk');
exports.main = withErrorMonitor(main, { source: { app: 'my-app', action: 'sync-orders', version: '1.0.0', environment: 'stage' } });
```

A Commerce webhook:
```js
const { withWebhookErrorMonitor } = require('@commerce-ext/error-monitor-sdk');
exports.main = withWebhookErrorMonitor(main, {
  source: { app: 'my-app', action: 'check-stock' },
  onError: 'exception',                                   // or 'success' to let Commerce continue
  customerMessage: 'We could not check stock right now. Please try again.',
});
```

**5. Deploy:** run `aio app build && aio app deploy`. Errors then appear in Commerce Admin under **System → Error Monitor**.

Working examples: `apps/sample-consumer/actions/orders-sync` (normal action) and `apps/sample-consumer/actions/validate-cart` (webhook).

## API

| Export | Purpose |
|---|---|
| `withErrorMonitor(handler, { source, recordErrorResponses=true, timeoutMs=3000, resolveOptions?, fetchImpl? })` | Wrap `main`. Thrown errors are recorded and answered with `500 { error, errorId }`. Returned server-error responses (status 500–599) are recorded and returned unchanged. Reads `ERROR_MONITOR_ENDPOINT` / `ERROR_MONITOR_SIGNING_KEY` from action params unless `resolveOptions(params)` is given. Never throws. |
| `withWebhookErrorMonitor(handler, { source, onError='exception'\|'success', customerMessage, timeoutMs=1000 })` | For **Commerce webhooks**. Your normal answers pass through. On an unexpected error, records it and returns HTTP 200 with a valid webhook operation: `exception` with your message plus a reference ID, or `success` to fail open. The error text is never sent to Commerce. |
| `createErrorMonitor({ endpoint, signingKey, source, timeoutMs=3000, throttle, fetchImpl, onTransportError })` | `.record(error, { severity, context, source, timestamp }) → { recorded, id?, reason? }`, for errors you catch yourself. Never throws. |
| `normalizePayload`, `validateRecord`, `sanitizeText`, `sign`, `verifySignature` | Used by the monitor itself; exported for tests and tools. |
| `@commerce-ext/error-monitor-sdk/schema.json` | JSON Schema of the stored `ErrorRecord` v1. |

## Safety
- **Connection:** an `https` endpoint is required; plain `http` is allowed only for `localhost` with `allowInsecureLocalhost`. Redirects are refused.
- **Never breaks your action:** by default, reporting stops after 3 s (1 s for webhooks); change it with `timeoutMs`. `record()` never throws.
- **Choosing `timeoutMs`:** for event handlers and background actions, 5000 allows for a cold start of the Error Monitor. For webhooks, keep it below the webhook's timeout in Commerce. If reporting takes longer than `timeoutMs`, your action continues without an `errorId`; the error is usually still saved, but this is not guaranteed.
- **Limits:** at most 5 reports per error type per minute per warm container; payload capped at 64 KB.
- **What is sent:** only these context fields: `requestId`, `activationId`, `http{method,path,status}` and up to 20 `tags`. Request bodies and headers are never sent.
- **Masking:** passwords, tokens, keys, emails and card numbers in messages are masked before sending, and the server masks again. Masking is pattern-based, so do not put secrets in error messages on purpose.
