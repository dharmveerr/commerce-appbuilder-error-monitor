# Commerce App Builder Error Monitor

A reusable error-monitoring solution for Adobe Commerce **App Builder** applications.
Works with **Adobe Commerce as a Cloud Service (ACCS, SaaS)**, including sandbox instances, and with **Adobe Commerce on Cloud / on-premises (PaaS)**.

| Piece | Path | What it is |
|---|---|---|
| Shared npm package | `packages/error-monitor-sdk` | `@commerce-ext/error-monitor-sdk`: sanitizes errors and sends them (HMAC-signed) to the monitor. Zero runtime dependencies. |
| Runtime actions + dashboard | `apps/error-monitor` | `record-error` (normalize → State → Files → Events), `list-errors`, `get-error`, `registration`, and a Commerce Admin page (Admin UI SDK). |
| Reuse demonstration | `apps/sample-consumer` | A *separate* App Builder app that adopts the SDK with one `require` and one wrapper. |
| Docs | `docs/` | Setup guide, technical design, implementation plan, test results, hand-off. |

> **Status:** proof of concept. The logic is covered by 60 automated tests (`docs/test-results.md`). Deployment to a
> non-production workspace and the on-instance dashboard check are **pending**. All names, URLs and IDs are generic placeholders.

```
 consumer action ──(SDK: sanitize + HMAC)──▶ record-error ─┬─▶ Adobe I/O State   (recent, TTL)
                                                           ├─▶ Adobe I/O Files   (archive)
                                                           └─▶ Adobe I/O Events  (notification)
 Commerce Admin ▶ Error Monitor page ──(IMS token from Admin)──▶ list-errors / get-error ─▶ State | Files
```

## Compatibility

| Part | ACCS sandbox (SaaS) | PaaS |
|---|---|---|
| SDK, `record-error`, State / Files / Events | ✅ Identical (runs in App Builder, not in Commerce) | ✅ |
| Admin dashboard | ✅ Admin UI SDK is pre-installed; enable it and select the workspace | ✅ Admin UI SDK ≥ 3.0.0 via Composer (included from 2.4.8) |
| Local `localhost` testing of the Admin page | ❌ PaaS-only; test by deploying to the Stage workspace | ✅ |
| Cache refresh | Save Admin UI SDK settings / **Refresh registrations** | also `bin/magento cache:clean` |

**Important:** the dashboard uses the Admin UI SDK **V1** extension point (`commerce/backend-ui/1`), which Adobe has **deprecated** in favour of V2 (`commerce/backend-ui/2`, built on App Management). It still works, but it will be removed in a future release; migration is the first recommended next step (design doc, risk R8). The App Builder project must be in the **same Adobe organization** as the Commerce instance.

## Quick start

Full step-by-step instructions, including ACCS sandbox provisioning and troubleshooting: **[docs/setup-and-installation.md](docs/setup-and-installation.md)**.

1. **Tools:** Node.js 20, `npm install -g @adobe/aio-cli`, `aio login`.
2. **Commerce:** a non-production instance. For ACCS, create a sandbox in **Commerce Cloud Manager → Add Instance**.
3. **Developer Console:** in the *same org* as the instance, create an App Builder project and use the **Stage** workspace. Add *I/O Management API*; optionally add *I/O Events* plus an *OAuth Server-to-Server* credential for notifications.
4. **Code and tests:**
   ```bash
   git clone <approved-internal-repo-url> commerce-appbuilder-error-monitor && cd commerce-appbuilder-error-monitor
   npm install && npm test            # 60 tests, no network needed
   ```
5. **Deploy the monitor:**
   ```bash
   cd apps/error-monitor
   aio app use                        # pick the Stage workspace
   # copy remaining keys from .env.example into .env and fill them (see table below)
   aio app deploy && aio app get-url
   ```
6. **Commerce Admin:** go to **Stores → Settings → Configuration → Adobe Services → Admin UI SDK**.
   - Set **Enable Admin UI SDK = Yes**.
   - Click **Configure extensions** → choose **Stage** → **Apply** → tick **Error Monitor** → **Save**.
   - Reload the Admin and open **App Builder Apps → Error Monitor**.
7. **Sample app:**
   ```bash
   cd ../sample-consumer
   aio app use
   # set ERROR_MONITOR_ENDPOINT (record-error URL) and ERROR_MONITOR_SIGNING_KEY (same as INGEST_SIGNING_KEY) in .env
   aio app deploy
   ```
8. **Verify:** `npm run smoke` from the repo root, then the manual checks in the setup guide, Part 8.

## Configuration (Error Monitor `.env`)

| Setting | Required | Meaning |
|---|---|---|
| `COMMERCE_INSTANCE_ID` | yes | Label of the Commerce instance this deployment serves (`[A-Za-z0-9_-]{1,64}`). Stamped on every record **by the server**. |
| `INGEST_SIGNING_KEY` | yes | ≥ 32 chars (`openssl rand -hex 32`). HMAC key shared with consumer apps. Secret. |
| `IMS_ORG_ID` | yes (dashboard) | `<id>@AdobeOrg`, the same org as the Commerce instance. Fails closed if unset. |
| `STATE_TTL_SECONDS` | no (604800) | How long a record stays in State (60 … 31 536 000). |
| `ARCHIVE_ENABLED` | no (true) | Write each record to Files. |
| `EVENT_PROVIDER_ID` | for Events | Events provider id. Setting it enables notifications (unless `EVENTS_ENABLED=false`). |
| `EVENT_CODE` | no | CloudEvents `type`. Default `com.example.commerce.error_monitor.error_recorded`. |
| `EVENT_MIN_SEVERITY` | no (error) | `debug`\|`info`\|`warning`\|`error`\|`critical`. |
| `IMS_CLIENT_ID`, `IMS_CLIENT_SECRET`, `IMS_SCOPES` | for Events | OAuth Server-to-Server credentials used to publish. Secrets. |

## Reuse the SDK in another App Builder app

```js
const { withErrorMonitor } = require('@commerce-ext/error-monitor-sdk');
exports.main = withErrorMonitor(myHandler, { source: { app: 'my-app', action: 'my-action', version: '1.0.0', environment: 'stage' } });
```
Then add two action inputs: `ERROR_MONITOR_ENDPOINT` and `ERROR_MONITOR_SIGNING_KEY`.

`record()` never throws. If the monitor is down, your action behaves exactly as before.
See `apps/sample-consumer` and `packages/error-monitor-sdk/README.md`.

## Verify on first deploy

`npm run smoke` covers acceptance checks AC1–AC6 against the deployed workspace. The following could not be exercised offline; confirm each and record the result in `docs/test-results.md` §3:

1. `raw-http` delivers the exact JSON bytes in `__ow_body`. The HMAC depends on it; smoke check AC1 proves it.
2. **`require-adobe-auth` rejects IMS tokens from other organizations.** The `x-gw-ims-org-id` check in `list-errors` compares a header the browser sends, so on its own it is a consistency check, not a security boundary. Test with a token from another org (setup guide, Part 8, step 3).
3. `@adobe/aio-lib-state` exposes `list({ match })` in the installed major version.
4. The Admin UI SDK lists the extension under **Configure extensions** for the Stage workspace, and the page receives `imsToken` / `imsOrgId` from the shared context. Confirm V1 is still offered on the instance.
5. Events: the event appears in the Developer Console journal.

## Security notes
- Only allow-listed fields are stored. Secrets and PII are masked on the client, on the server, and again on output. Redaction is best-effort pattern matching (design doc, risk R2).
- `record-error` authenticates machines with HMAC-SHA256 and a 5-minute timestamp window. Dashboard actions require an IMS token (`require-adobe-auth`). The page receives that token only from the Commerce Admin shared context, never from the URL.
- No secrets in source: `.env` is git-ignored, and test fixtures assemble synthetic secret-shaped strings at runtime.

## Documents
- [`docs/setup-and-installation.md`](docs/setup-and-installation.md): step-by-step setup (ACCS and PaaS)
- [`docs/technical-design.md`](docs/technical-design.md): design, schema, security model, decisions, risks
- [`docs/implementation-plan.md`](docs/implementation-plan.md): tasks, dependencies, status, approvals needed
- [`docs/test-results.md`](docs/test-results.md): acceptance-check evidence
- [`docs/handoff.md`](docs/handoff.md): demo script, known limitations, next steps
