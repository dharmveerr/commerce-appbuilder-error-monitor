# Setup and Installation Guide

This guide deploys the Error Monitor to an **Adobe Commerce as a Cloud Service (ACCS)** instance, for example a sandbox, and connects the sample app that reports errors to it.

| Part | Runs in | Installed by |
|---|---|---|
| Error Monitor actions (`record-error`, `list-errors`, `get-error`) | Adobe I/O Runtime (App Builder) | `aio app deploy` |
| Error storage and notifications | Adobe I/O State, Files and Events | Used automatically by the actions |
| Admin dashboard (**System → Error Monitor**) | Commerce Admin (Admin UI SDK V2) | **Apps → App Management** |
| SDK | Inside every app that reports errors | `npm install` in that app |

> Never commit `.env` files, signing keys, client secrets or tokens. The repository's `.gitignore` already excludes them.

---

## 1. Prerequisites

| Item | Details |
|---|---|
| Node.js | 22 or 24 (`node -v`) |
| Adobe I/O CLI | `npm install -g @adobe/aio-cli`, then `aio login` |
| Commerce instance | ACCS instance or sandbox, opened from **Commerce Cloud Manager** |
| Adobe Developer Console | Access to create or edit an App Builder project in the **same Adobe organization** as the Commerce instance |
| Tools | `git` and `openssl` (on Windows, use Git Bash) |

---

## 2. Prepare Adobe Developer Console

1. Open Adobe Developer Console and select the organization that owns the Commerce instance.
2. Create a project from the **App Builder** template, or open an existing App Builder project.
3. Open the workspace you will deploy to, for example **Stage**.
4. Add these services to the workspace:

   | Service | Purpose |
   |---|---|
   | **I/O Management API** (OAuth Server-to-Server credential) | Required. Used by App Management. |
   | **Adobe Commerce as a Cloud Service** | Required for ACCS instances. |
   | **I/O Events** | Optional. Needed only for error notifications. |

---

## 3. Get the code and run the tests

```bash
git clone <repository-url> commerce-appbuilder-error-monitor
cd commerce-appbuilder-error-monitor
npm install
npm test
```

`npm install` installs all dependencies and prepares the App Management files. `npm test` runs the automated test suite; it needs no Adobe account or network access and should report **0 failures**.

---

## 4. Configure and deploy the Error Monitor

1. Link the app to your workspace:
   ```bash
   cd apps/error-monitor
   aio app use
   ```
   Select the organization, project and workspace from step 2. If asked about an existing `.env`, choose **merge**.

2. Create a signing key:
   ```bash
   openssl rand -hex 32
   ```
   **What is it?** A shared secret between the Error Monitor and the apps that report errors. Each app signs its error reports with this key, and the Error Monitor accepts only reports with a valid signature. The key itself is never sent, only the signature.
   - The Error Monitor stores it as `INGEST_SIGNING_KEY`.
   - Each reporting app stores the **same value** as `ERROR_MONITOR_SIGNING_KEY`.
   - Keep it only in `.env` files or a secret store. Never commit it or share it by email or chat.
   - To change it, create a new key, update both `.env` files and run `aio app deploy` in both apps.

3. Add these settings to `apps/error-monitor/.env` (see [`.env.example`](../apps/error-monitor/.env.example)):
   ```
   COMMERCE_INSTANCE_ID=sandbox-1
   INGEST_SIGNING_KEY=<the key from step 2>
   IMS_ORG_ID=<org-id>@AdobeOrg
   STATE_TTL_SECONDS=604800
   ARCHIVE_ENABLED=true
   ```
   - `COMMERCE_INSTANCE_ID` is a short label of your choice that identifies this Commerce instance on every error.
   - `IMS_ORG_ID` is the organization ID shown in Developer Console, ending in `@AdobeOrg`.

4. **Optional: error notifications (Adobe I/O Events).**
   1. Create an events provider and event code:
      ```bash
      aio event provider create
      aio event eventmetadata create <providerId>
      ```
      Use the event code `com.example.commerce.error_monitor.error_recorded`, or your own value in `EVENT_CODE`.
   2. Add to `.env`:
      ```
      EVENT_PROVIDER_ID=<providerId>
      EVENT_CODE=com.example.commerce.error_monitor.error_recorded
      EVENT_MIN_SEVERITY=error
      IMS_CLIENT_ID=<OAuth Server-to-Server client ID>
      IMS_CLIENT_SECRET=<OAuth Server-to-Server client secret>
      IMS_SCOPES=<the scopes listed on that credential, comma-separated>
      ```
   3. In Developer Console, add an **Events registration** for the event code (a journal registration is the simplest way to watch events arrive).

5. Deploy:
   ```bash
   aio app deploy
   ```
   The build validates `app.commerce.config.ts`, bundles the actions and the dashboard, and deploys them.

6. Show the action URLs and note them for later steps:
   ```bash
   aio app get-url
   ```
   You need the URLs of `error-monitor/record-error`, `error-monitor/list-errors` and `error-monitor/get-error`.

---

## 5. Install the dashboard in Commerce Admin

1. Sign in to the Commerce Admin.
2. **Enable the Admin UI SDK:** **Stores → Settings → Configuration → Adobe Services → Admin UI SDK** → set **Enable Admin UI SDK** to **Yes** → **Save Config**. Skip this if it is already enabled.
3. **Allow your role to manage apps:** **System → Permissions → User Roles** → your role → **Role Resources** → under **Admin UI SDK**, select **App Management** → **Save Role**.
4. **Associate the app:** **Apps → App Management** → **Associate App** → select the project and workspace from step 2 → **Associate**.
5. **Install the app:** on the **Error Monitor** card, open the installation dialog and select **Install**. Keep the page open until it reports **Successfully Installed**.
6. **Open the dashboard:** **System → Error Monitor**. The page shows *App Builder Error Monitor* and, until an error is reported, the message *"No errors match these filters…"*.

**Access:** administrators whose role can use Admin UI SDK apps see the dashboard.

---

## 6. Connect the sample app

The sample app shows the SDK in an app that is separate from the Error Monitor. Deploy it to a **different workspace** (another project, or another workspace of the same project) in the same organization, so the two deployments stay independent.

1. Link the app:
   ```bash
   cd ../sample-consumer
   aio app use
   ```
2. Add to `apps/sample-consumer/.env`:
   ```
   ERROR_MONITOR_ENDPOINT=<record-error URL from section 4, step 6>
   ERROR_MONITOR_SIGNING_KEY=<the same value as INGEST_SIGNING_KEY>
   UPSTREAM_TOKEN=demo-token-7f3a9c21
   ```
3. Deploy:
   ```bash
   aio app deploy
   ```
4. Report an error that contains sample sensitive values:
   ```bash
   aio runtime action invoke sample-consumer/orders-sync \
     --param simulate leak --param customerEmail test@example.com
   aio runtime activation result --last
   ```
   The action replies with a generic `500` error and an `errorId`. (Avoid `--result` for failing calls: the CLI retries blocking calls that end in an error, which records the same error more than once.)
5. In Commerce Admin, select **Refresh** on the Error Monitor page. The error appears, and the email address and token are shown as `[REDACTED_EMAIL]` and `[REDACTED]`.

The [demo guide](demo-guide.md) covers the remaining scenarios, including the webhook example.

---

## 7. Verify the deployment

Run the end-to-end check from the repository root. It sends a signed test error with synthetic sensitive values and checks storage, archive, notifications, the dashboard API and rejection of invalid requests.

```bash
cd ../..
export ERROR_MONITOR_ENDPOINT=<record-error URL>
export ERROR_MONITOR_SIGNING_KEY=<INGEST_SIGNING_KEY>
export LIST_ERRORS_URL=<list-errors URL>
export GET_ERROR_URL=<get-error URL>
export IMS_ORG_ID=<org-id>@AdobeOrg
export IMS_ACCESS_TOKEN=$(aio login --bare)

# Also checks the raw stored copies (values from apps/error-monitor/.env):
export AIO_runtime_namespace=<namespace>  AIO_runtime_auth=<auth>  COMMERCE_INSTANCE_ID=sandbox-1

npm run smoke
```

Every check should read `PASS`. The raw Files copy is reported as `SKIP` when run from a workstation, because Adobe I/O Files accepts requests only from Runtime actions; the archive is still verified through `list-errors` and the raw State copy. If notifications are enabled, also confirm in Developer Console (**Events registration → Debug Tracing / Journal**) that one event arrived for the test error.

---

## 8. Updating the app

- **Action or dashboard code changes:** run `aio app deploy` again.
- **Menu changes** in `app.commerce.config.ts`: increase `metadata.version` (for example `0.1.0` → `0.1.1`), run `aio app deploy`, then start the upgrade from **Apps → App Management**.

---

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---|---|---|
| `aio app deploy` reports a configuration validation error | A field in `app.commerce.config.ts` does not meet App Management rules | The message names the field. `npm test` checks the same rules. |
| The app is not listed in **Associate App** | Deployed to a different workspace, or the project is in a different organization | Run `aio app deploy` in the intended workspace and confirm the organization in Developer Console |
| **Apps → App Management** is missing | Admin UI SDK disabled, or the role lacks App Management permission | Section 5, steps 2–3 |
| Installation stops part-way | The page was closed during installation | Open the app in App Management and run the installation again |
| The page says *"Open this page from the Commerce Admin menu"* | Opened outside the Commerce Admin | Open it from **System → Error Monitor** |
| The page says *"Your Adobe account can't view error records…"* | `IMS_ORG_ID` does not match the administrator's organization | Correct `IMS_ORG_ID` and redeploy |
| `record-error` returns `401 unauthorized` | The apps use different signing keys, or a system clock is more than 5 minutes off | Use exactly the same key in both `.env` files |
| `500 service_misconfigured` | A required setting is missing or invalid | `aio app logs` names the setting (never its value) |
| `503 storage_unavailable` | Adobe I/O State could not be reached | Retry; check `aio app logs` |
| The `record-error` reply contains `"event": { "emitted": false }` | Notifications disabled, severity below `EVENT_MIN_SEVERITY`, or wrong credentials | Check `reason` in the reply and the `EVENT_*` / `IMS_CLIENT_*` settings |
| The dashboard renders twice during local development | React StrictMode in development builds | Expected; deployed builds render once |
