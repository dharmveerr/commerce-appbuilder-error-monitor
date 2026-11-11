# Setup and Installation Guide

This guide takes a developer from an empty machine to a working Error Monitor in a **non-production** environment.
It covers **Adobe Commerce as a Cloud Service (ACCS, SaaS) sandbox instances** and **Adobe Commerce on Cloud / on-premises (PaaS)**.
Where the two differ, the step says so.

> Use generic values only. Never commit `.env` files, keys, tokens or customer URLs.

---

## 0. Will it work on my Commerce?

| Part | ACCS sandbox (SaaS) | PaaS (on Cloud / on-premises) |
|---|---|---|
| Shared npm package, `record-error`, State, Files, Events | ✅ Same. These run in App Builder, not in Commerce. | ✅ Same |
| Admin dashboard (Admin UI SDK) | ✅ Admin UI SDK is already installed on ACCS; you switch it on and pick the workspace (Part 6). | ✅ Needs Admin UI SDK installed with Composer (≥ 3.0.0; 2.4.8+ includes it). |
| Local testing of the Admin page against `localhost` | ❌ Not available (PaaS-only feature). Test by deploying to the **Stage** workspace. | ✅ Optional |
| Clearing caches | No command line. Saving the Admin UI SDK settings refreshes registrations; use **Refresh registrations** if needed. | `bin/magento cache:clean` also works |

**Two things to know before you start:**
1. **The dashboard uses the Admin UI SDK V1 extension point (`commerce/backend-ui/1`).** Adobe has deprecated V1 in favour of V2 (`commerce/backend-ui/2`, built on App Management). V1 still works today, but it will be removed in a future release. If your sandbox no longer lists V1 extensions in Part 6, the dashboard must be migrated to V2 first (design doc, risk R8). The backend parts are not affected.
2. **The App Builder project must be in the same Adobe organization as the Commerce instance.** The Admin finds extensions through that organization.

---

## Part 1. Install the tools on your computer

1. Install **Node.js 20** (18 is the minimum; actions run on Node 20). Check:
   ```bash
   node -v
   npm -v
   ```
2. Install the **Adobe I/O CLI**:
   ```bash
   npm install -g @adobe/aio-cli
   ```
3. Log in:
   ```bash
   aio login
   ```
4. Install `git` and `openssl` (usually already present on macOS/Linux; on Windows use Git Bash).

---

## Part 2. Get a non-production Commerce instance

### 2A. ACCS sandbox
1. Open **Commerce Cloud Manager** in Adobe Experience Cloud.
2. If you don't already have one, click **Add Instance** and create a **sandbox** instance. Pick the region closest to you.
3. Wait until it shows as ready, then use the instance's link to open the **Commerce Admin**.
4. Make sure your user has Commerce Admin access. This is granted through Adobe Admin Console product profiles; ask your system administrator if you can't log in.
5. Note the **Adobe organization** the instance belongs to. Your App Builder project must be in the same organization (Part 3).

### 2B. PaaS (alternative)
1. Use a non-production environment (for example, Staging or an Integration branch).
2. Install the Admin UI SDK if it's not already included:
   ```bash
   composer require "magento/commerce-backend-sdk": ">=3.0"
   bin/magento setup:upgrade
   ```

---

## Part 3. Prepare Adobe Developer Console (one time)

1. Open Adobe Developer Console and **select the same organization** as your Commerce instance (top-right menu).
2. Create a **project from the App Builder template**, or open an existing one.
3. Open the **Stage** workspace. Use only non-production workspaces for this proof of concept.
4. Add the **I/O Management API** to the workspace.
5. **Optional, for error notifications:**
   - Add **I/O Events** to the workspace.
   - Add an **OAuth Server-to-Server** credential. Note its Client ID and Client Secret.
   - You can skip this whole step and turn notifications on later.

---

## Part 4. Get the code and run the tests

1. Clone the approved repository. Until it exists, unpack the delivered archive instead:
   ```bash
   git clone <approved-internal-repo-url> commerce-appbuilder-error-monitor
   # or: tar -xzf commerce-appbuilder-error-monitor.tar.gz && mv repo commerce-appbuilder-error-monitor
   cd commerce-appbuilder-error-monitor
   ```
2. Install dependencies. This also links the shared package into both apps.
   ```bash
   npm install
   ```
3. Run the tests. You should see **60 tests, 0 failures**. No Adobe account is needed for this.
   ```bash
   npm test
   ```

---

## Part 5. Configure and deploy the Error Monitor app

1. Go to the app folder:
   ```bash
   cd apps/error-monitor
   ```
2. Link the folder to your project and the **Stage** workspace. This writes the Adobe connection details into `.env`.
   ```bash
   aio app use
   ```
3. Open `.env.example`, copy the remaining settings to the bottom of `.env`, and fill them in.
4. Create a signing key and put it in `INGEST_SIGNING_KEY`:
   ```bash
   openssl rand -hex 32
   ```
5. Fill in the minimum settings:
   ```
   COMMERCE_INSTANCE_ID=sandbox-instance-1     # any short label for this Commerce instance
   INGEST_SIGNING_KEY=<key from step 4>
   IMS_ORG_ID=<org-id>@AdobeOrg                # same org as the Commerce instance
   STATE_TTL_SECONDS=604800                    # keep recent errors 7 days
   ARCHIVE_ENABLED=true
   ```
6. **Optional: turn on notifications.**
   1. Create an Events provider and an event code, in Developer Console or with the CLI:
      ```bash
      aio event provider create
      aio event eventmetadata create <providerId>
      ```
   2. Fill in:
      ```
      EVENT_PROVIDER_ID=<providerId>
      EVENT_CODE=com.example.commerce.error_monitor.error_recorded
      EVENT_MIN_SEVERITY=error
      IMS_CLIENT_ID=<OAuth Server-to-Server client id>
      IMS_CLIENT_SECRET=<OAuth Server-to-Server client secret>
      IMS_SCOPES=openid,AdobeID,adobeio_api
      ```
   3. In Developer Console, add an **Events registration** for that event code, for example with a journal or a webhook, so you can see the events arrive.
   4. If `EVENT_PROVIDER_ID` stays empty, notifications are off and everything else still works.
7. Deploy:
   ```bash
   aio app deploy
   ```
   This deploys the actions, uploads the dashboard page, and registers the extension for the `commerce/backend-ui/1` extension point in this workspace.
8. Print the action URLs and **write them down**. You'll need `record-error`, `list-errors` and `get-error`.
   ```bash
   aio app get-url
   ```

**If the deploy can't find the shared package** (a known monorepo issue, design doc R7), install it as a packed file instead:
```bash
cd ../../packages/error-monitor-sdk && npm pack
cd ../../apps/error-monitor && npm install ../../packages/error-monitor-sdk/commerce-ext-error-monitor-sdk-0.1.0.tgz
aio app deploy
```

---

## Part 6. Show the dashboard in Commerce Admin

1. Log in to the **sandbox** Commerce Admin (ACCS: through Commerce Cloud Manager).
2. Go to **Stores → Settings → Configuration → Adobe Services → Admin UI SDK**.
3. In **General configuration**, set **Enable Admin UI SDK** to **Yes** and save. The SDK is off by default.
4. Click **Configure extensions**.
5. Select the workspace: choose **Stage**. If you used a custom workspace, choose **Custom** and type its exact name.
6. Click **Apply**. The eligible extensions list loads.
7. Tick **Error Monitor** (the extension you deployed) and **save**.
8. Reload the Admin. A section **App Builder Apps** with the menu item **Error Monitor** should appear.
   - ACCS: saving the configuration refreshes registrations. If the menu doesn't appear, use **Refresh registrations** on the same configuration page.
   - PaaS: you can also run `bin/magento cache:clean`.
9. Click **Error Monitor**. The page should load and show **"No error records found for the selected filters."**
   - If it says *"This page must be opened from the Commerce Admin menu"*, the page didn't receive the Adobe sign-in from the Admin. See Troubleshooting.
   - Admin UI SDK logs can be checked under **System → Admin UI SDK → Admin UI SDK Logs**, if database logging is enabled.

---

## Part 7. Connect the sample app (reuse proof)

1. Go to the sample app and link it to a workspace. It can be the same workspace or another one in the same project.
   ```bash
   cd ../sample-consumer
   aio app use
   ```
2. Add to its `.env`:
   ```
   ERROR_MONITOR_ENDPOINT=<record-error URL from Part 5, step 8>
   ERROR_MONITOR_SIGNING_KEY=<the SAME value as INGEST_SIGNING_KEY>
   UPSTREAM_TOKEN=demo-not-a-real-token
   ```
3. Deploy:
   ```bash
   aio app deploy
   ```
4. Make it fail on purpose, with fake sensitive data:
   ```bash
   aio runtime action invoke sample-consumer/orders-sync \
     --param simulate leak --param customerEmail test@example.com --result
   ```
   The reply is a 500 error with an `errorId`.
5. Refresh the Error Monitor page in Commerce Admin. The error appears, with the email and token shown as `[REDACTED_EMAIL]` / `[REDACTED]`.

---

## Part 8. Verify and record the results

1. Run the automatic checks from the repo root:
   ```bash
   cd ../..
   export ERROR_MONITOR_ENDPOINT=...  ERROR_MONITOR_SIGNING_KEY=...
   export LIST_ERRORS_URL=...  GET_ERROR_URL=...
   export IMS_ACCESS_TOKEN=<a valid IMS token for your org>  IMS_ORG_ID=...
   npm run smoke
   ```
   It prints PASS or FAIL for each acceptance check.
2. If notifications are on, open the Events registration in Developer Console. Check its journal or debug tracing shows **one event** for the test error.
3. **Manual security check:** call `list-errors` with a valid IMS token from a **different** Adobe organization. It must be refused (401 or 403). See design doc §5 for why this matters.
4. Check the dashboard by hand:
   - the list shows the error
   - the detail window opens
   - filtering by a non-existent app shows the empty message
5. Write all results, with screenshots, into `docs/test-results.md` §3.

---

## Troubleshooting

| What you see | Most likely cause | Fix |
|---|---|---|
| `unauthorized` (401) from `record-error` | The keys differ between the two apps, or the computer clock is wrong | Use exactly the same key in both `.env` files; sync the clock |
| `service_misconfigured` (500) | A required setting is missing or too short | `aio app logs` shows which setting, never its value |
| `forbidden` (403) on the dashboard | `IMS_ORG_ID` doesn't match the signed-in organization | Copy the exact org ID from Developer Console |
| Error Monitor isn't in the *Configure extensions* list | Not deployed to the selected workspace, a different organization, or V1 no longer offered on this instance | Re-run `aio app deploy` in the right workspace; check the org; if V1 is gone, see risk R8 |
| Menu missing after saving | Registrations not refreshed | Click **Refresh registrations** (ACCS) or `bin/magento cache:clean` (PaaS) |
| Page says "must be opened from the Commerce Admin menu" | Page opened directly, or the extension ID doesn't match | Open it from the Admin menu; `extensionId` in `web-src/src/constants.js` must equal `EXTENSION_ID` in the registration action (a test checks this) |
| `notification sent: no` in the record-error reply | Notifications off, threshold too high, or wrong credentials | Check the `EVENT_…` and `IMS_CLIENT_…` settings and `EVENT_MIN_SEVERITY` |

---

## Adding the monitor to another app later

1. Install the shared package: `npm install @commerce-ext/error-monitor-sdk` (from the internal registry once published).
2. Wrap the action:
   ```js
   const { withErrorMonitor } = require('@commerce-ext/error-monitor-sdk');
   exports.main = withErrorMonitor(myHandler, { source: { app: 'my-app', action: 'my-action' } });
   ```
3. Add two inputs to the action: `ERROR_MONITOR_ENDPOINT` and `ERROR_MONITOR_SIGNING_KEY`.

That is all. `apps/sample-consumer` is a working example.
