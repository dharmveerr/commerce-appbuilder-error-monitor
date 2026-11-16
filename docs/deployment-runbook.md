# Deployment Runbook (internal)

Exact steps used to deploy the Error Monitor for the demo on 2026-11-15, written so they can be repeated by hand. Values shown are identifiers, not secrets. Secrets live only in the git-ignored files listed in §9.

## 0. Environment used

| Item | Value |
|---|---|
| Adobe organization | ACCS - PM and Engineering · org ID `3117813` · IMS org `045013D3664331DC0A495CD5@AdobeOrg` |
| Developer Console project | `CommerceErrorMonitor` (title *Commerce Error Monitor*), project ID `4566206088345797425` |
| Workspace for the Error Monitor | `Stage` · ID `4566206088345848685` · namespace `3117813-commerceerrormonitor-stage` |
| Workspace for the sample app | `Sample` · ID `4566206088345848686` · namespace `3117813-commerceerrormonitor-sample` |
| APIs on `Stage` | I/O Management API (`AdobeIOManagementAPISDK`), I/O Events (`CloudIntegrationSDK`), Adobe Commerce as a Cloud Service (`ACCS-REST-API`, product profile *Default - Cloud Manager*) |
| Events provider | *Commerce Error Monitor* · ID `61ca757a-f99c-4deb-a378-cf84705867fc` |
| Event code | `com.example.commerce.error_monitor.error_recorded` |
| Events registration | *Error Monitor Journal* (journal) · ID `7efda9a3-03ae-4010-abab-3da829006efa` |
| `COMMERCE_INSTANCE_ID` | `DsqTQJTsE4VADkLsDXodtY` (ACCS instance ID of *GDC Commerce Sandbox 1*; first test records used `accs-demo-sandbox`) |
| Tools | Node.js 24.21, `@adobe/aio-cli` 11.2.0 |

### Deployed URLs

| Action | URL |
|---|---|
| `record-error` (= `ERROR_MONITOR_ENDPOINT`) | `https://3117813-commerceerrormonitor-stage.adobeioruntime.net/api/v1/web/error-monitor/record-error` |
| `list-errors` | `https://3117813-commerceerrormonitor-stage.adobeioruntime.net/api/v1/web/error-monitor/list-errors` |
| `get-error` | `https://3117813-commerceerrormonitor-stage.adobeioruntime.net/api/v1/web/error-monitor/get-error` |
| Dashboard (opens inside Commerce Admin only) | `https://3117813-commerceerrormonitor-stage.adobeio-static.net/index.html` |
| Sample webhook `validate-cart` | `https://3117813-commerceerrormonitor-sample.adobeioruntime.net/api/v1/web/sample-consumer/validate-cart` |
| Sample action `orders-sync` | non-web; invoke with `aio runtime action invoke sample-consumer/orders-sync` |

---

## 1. Prerequisites (once per machine)

```bash
node -v                       # v22.x or v24.x
npm install -g @adobe/aio-cli
aio login
aio where                     # must show: Org: ACCS - PM and Engineering
```

If the organization is wrong: `aio console org list`, then `aio console org select 3117813`.

From the repository root:

```bash
npm install
npm test                      # 80 tests, 0 failures
```

---

## 2. Create the Developer Console project and workspaces

> Do not reuse another app's project (for example *Comm Cart Validation*). Two App Management apps in one workspace overwrite each other's generated `app-management` actions.

```bash
# Project names must be alphanumeric (no hyphens)
aio console project create -o 3117813 -n CommerceErrorMonitor \
  -t "Commerce Error Monitor" -d "Reusable error monitor for Commerce App Builder apps (non-production demo)" --json

# Production and Stage workspaces are created automatically. Add one for the sample app:
aio console workspace create --orgId 3117813 --projectName CommerceErrorMonitor \
  --name Sample --title "Sample consumer app" --json
```

**Console UI alternative:** Developer Console → **Create project from template** → *App Builder* → title *Commerce Error Monitor* → Save. Then **Add workspace** → `Sample`.

---

## 3. Add APIs to the `Stage` workspace

```bash
aio console workspace api add --orgId 3117813 --projectName CommerceErrorMonitor --workspaceName Stage \
  --service-code AdobeIOManagementAPISDK,CloudIntegrationSDK --json

aio console workspace api add --orgId 3117813 --projectName CommerceErrorMonitor --workspaceName Stage \
  --service-code ACCS-REST-API --license-config "ACCS-REST-API=Default - Cloud Manager" --json

aio console workspace api list --orgId 3117813 --projectName CommerceErrorMonitor --workspaceName Stage
```

The first call creates the workspace's **OAuth Server-to-Server** credential. Without `--license-config`, `ACCS-REST-API` fails with "requires one or more product profiles".

**Console UI alternative:** Stage workspace → **Add service → API** → *I/O Management API* (OAuth Server-to-Server), then *I/O Events*, then *Adobe Commerce as a Cloud Service* (select profile *Default - Cloud Manager*).

The `Sample` workspace needs no APIs.

---

## 4. Download the workspace files

```bash
mkdir -p .secrets && chmod 700 .secrets
aio console project select 4566206088345797425
aio console workspace select 4566206088345848685
aio console workspace download .secrets/stage-workspace.json
aio console workspace select 4566206088345848686
aio console workspace download .secrets/sample-workspace.json
chmod 600 .secrets/*.json
```

**Console UI alternative:** open the workspace → **Download all** (top right) → save as `.secrets/stage-workspace.json` / `.secrets/sample-workspace.json`.

These files contain the credential's client secret. `.secrets/` is git-ignored.

---

## 5. Create the Events provider, event code and journal

Select the Stage workspace first: `aio console workspace select 4566206088345848685`.

```bash
aio event provider create
#   label:        Commerce Error Monitor
#   description:  Notifications for errors recorded by the Commerce App Builder Error Monitor
#   docs url:     (empty)
# → note the provider "id"

aio event eventmetadata create <providerId>
#   label:        Error recorded
#   event code:   com.example.commerce.error_monitor.error_recorded
#   description:  An error was recorded by the Error Monitor (summary only)
```

Journal registration (for verifying notifications), file `.secrets/events-registration.json`:

```json
{
  "name": "Error Monitor Journal",
  "description": "Journal of Error Monitor notifications for verification and demos",
  "delivery_type": "journal",
  "events_of_interest": [{ "provider_id": "<providerId>", "event_code": "com.example.commerce.error_monitor.error_recorded" }]
}
```

```bash
aio event registration create .secrets/events-registration.json
```

**Console UI alternative:** Stage workspace → **Add service → Event** → *Custom events* provider *Commerce Error Monitor* → event *Error recorded* → OAuth Server-to-Server credential → **Journaling** → Save.

---

## 6. Configure and deploy the Error Monitor

```bash
cd apps/error-monitor
aio app use ../../.secrets/stage-workspace.json --merge --no-input   # writes .aio and .env (git-ignored)
openssl rand -hex 32                                                 # → INGEST_SIGNING_KEY
```

Append to `apps/error-monitor/.env`:

```
COMMERCE_INSTANCE_ID=DsqTQJTsE4VADkLsDXodtY
INGEST_SIGNING_KEY=<value from openssl>
IMS_ORG_ID=045013D3664331DC0A495CD5@AdobeOrg
STATE_TTL_SECONDS=604800
ARCHIVE_ENABLED=true

EVENT_PROVIDER_ID=<providerId>
EVENT_CODE=com.example.commerce.error_monitor.error_recorded
EVENT_MIN_SEVERITY=error
IMS_CLIENT_ID=<client_id of the OAuth Server-to-Server credential>
IMS_CLIENT_SECRET=<client secret of that credential>
IMS_SCOPES=<the credential's scopes, comma-separated>
```

`IMS_CLIENT_ID`, `IMS_CLIENT_SECRET` and the scopes are in `.secrets/stage-workspace.json` under `project.workspace.details.credentials[].oauth_server_to_server` (`client_id`, `client_secrets[0]`, `scopes`), or in Developer Console → Stage → **OAuth Server-to-Server** credential.

Deploy and list URLs:

```bash
aio app deploy
aio app get-url
cd ../..
```

A successful deploy ends with `New Extension Point(s) in Workspace 'Stage': 'commerce/backend-ui/2,commerce/extensibility/1'` and `Successful deployment`.

---

## 7. Configure and deploy the sample app

```bash
cd apps/sample-consumer
aio app use ../../.secrets/sample-workspace.json --merge --no-input
```

Append to `apps/sample-consumer/.env`:

```
ERROR_MONITOR_ENDPOINT=https://3117813-commerceerrormonitor-stage.adobeioruntime.net/api/v1/web/error-monitor/record-error
ERROR_MONITOR_SIGNING_KEY=<the same value as INGEST_SIGNING_KEY>
UPSTREAM_TOKEN=demo-token-7f3a9c21
```

```bash
aio app deploy
cd ../..
```

---

## 8. Verify

### 8.1 Sample scenarios

Run from `apps/sample-consumer`. Use non-blocking invokes: a blocking `--result` call that ends in an error is retried by the CLI and records the same error up to three times.

```bash
aio runtime action invoke sample-consumer/orders-sync --param simulate fail
aio runtime activation result --last          # 500 + errorId

aio runtime action invoke sample-consumer/orders-sync --param simulate leak --param customerEmail jane.doe@example.com
aio runtime activation result --last

aio runtime action invoke sample-consumer/orders-sync --param simulate unavailable
aio runtime activation result --last          # the action's own 503, unchanged
```

Webhook (needs an IMS token):

```bash
TOKEN=$(aio login --bare)
URL=https://3117813-commerceerrormonitor-sample.adobeioruntime.net/api/v1/web/sample-consumer/validate-cart
for d in '{"cart":{"items":[{"qty":2}]}}' '{"cart":{"items":[{"qty":60}]}}' '{"simulate":"fail"}'; do
  curl -s -X POST "$URL" -H "Authorization: Bearer $TOKEN" \
    -H "x-gw-ims-org-id: 045013D3664331DC0A495CD5@AdobeOrg" -H 'content-type: application/json' -d "$d"; echo
done
```

Expected: `success`; `exception "Carts are limited to 50 items."`; `exception "We could not check your cart right now. Please try again. (reference <id>)"`.

### 8.2 End-to-end check

```bash
export ERROR_MONITOR_ENDPOINT=https://3117813-commerceerrormonitor-stage.adobeioruntime.net/api/v1/web/error-monitor/record-error
export LIST_ERRORS_URL=https://3117813-commerceerrormonitor-stage.adobeioruntime.net/api/v1/web/error-monitor/list-errors
export GET_ERROR_URL=https://3117813-commerceerrormonitor-stage.adobeioruntime.net/api/v1/web/error-monitor/get-error
export IMS_ORG_ID=045013D3664331DC0A495CD5@AdobeOrg
export IMS_ACCESS_TOKEN=$(aio login --bare)
export COMMERCE_INSTANCE_ID=DsqTQJTsE4VADkLsDXodtY
# from apps/error-monitor/.env (do not paste into chat or tickets):
export ERROR_MONITOR_SIGNING_KEY=<INGEST_SIGNING_KEY>  AIO_runtime_namespace=<...>  AIO_runtime_auth=<...>
npm run smoke
```

Result on 2026-11-15: all checks `PASS`; raw Files copy `SKIP` (I/O Files accepts requests only from Runtime actions).

### 8.3 Events journal

Developer Console → CommerceErrorMonitor → Stage → *Error Monitor Journal* → **Debug Tracing** (or the journal view): one event per recorded error with severity `error` or higher.

---

## 9. Commerce Admin (manual, in the browser)

Use the ACCS sandbox in the **same organization** (ACCS - PM and Engineering).

1. Sign in to the Commerce Admin of the sandbox.
2. **Stores → Settings → Configuration → Adobe Services → Admin UI SDK** → *Enable Admin UI SDK* = **Yes** → **Save Config**.
3. **System → Permissions → User Roles** → your role → **Role Resources** → under **Admin UI SDK** tick **App Management** → **Save Role**.
4. **Apps → App Management → Associate App** → project **Commerce Error Monitor** → workspace **Stage** → **Associate**.
5. On the **Error Monitor** card → **Install** → keep the page open until **Successfully Installed**.
6. **System → Error Monitor**: the list shows the errors from §8 (application `sample-consumer`, `smoke-test`).
7. Record the result in `docs/test-results.md` §5.3.

---

## 10. Files that hold secrets (never commit, never share in chat)

| File | Contains |
|---|---|
| `.secrets/stage-workspace.json`, `.secrets/sample-workspace.json` | Workspace credentials (client secret) |
| `apps/error-monitor/.env` | Runtime auth, `INGEST_SIGNING_KEY`, `IMS_CLIENT_SECRET` |
| `apps/sample-consumer/.env` | Runtime auth, `ERROR_MONITOR_SIGNING_KEY` |
| `apps/*/.aio` | Workspace and Runtime configuration |

All are excluded by `.gitignore`. To rotate the signing key: generate a new one, update both `.env` files, redeploy both apps.

## 11. Before the demo

1. Warm up 5 minutes before: run one `orders-sync` failure. Cold starts take several seconds; warm calls about one second.
2. `aio where` should point at project *Commerce Error Monitor* when running CLI demo steps (run them from `apps/sample-consumer`, whose `.env` targets the Sample workspace).
3. Commerce Admin open on **System → Error Monitor**; Developer Console open on the journal.

## 12. Tear-down (after the demo, if required)

```bash
cd apps/sample-consumer && aio app undeploy && cd ../..
cd apps/error-monitor && aio app undeploy && cd ../..
```

Then uninstall the app in **Apps → App Management**, and delete the project in Developer Console if it is no longer needed.
