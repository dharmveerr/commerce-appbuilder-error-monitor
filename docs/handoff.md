# Demonstration & Hand-off

## 1. Demo script (≈ 15 min, non-production)
Prerequisites: README "Configure & deploy" completed for `apps/error-monitor`; sample consumer deployed with `ERROR_MONITOR_ENDPOINT` and `ERROR_MONITOR_SIGNING_KEY`.

1. **Reuse (2 min)** – open `apps/sample-consumer/actions/orders-sync/index.js`: the only integration is `require` + `withErrorMonitor(...)`; `app.config.yaml` adds two inputs. No monitor code, no customer code.
2. **Healthy call** – invoke `orders-sync` with `simulate=ok`: 200, nothing recorded.
3. **Failing call** – invoke with `simulate=fail`: caller receives a generic 500 + `errorId`.
4. **Sanitization** – invoke with `simulate=leak&customerEmail=<synthetic email>` (the action's `UPSTREAM_TOKEN` is a fake token): show the record contains `[REDACTED]` / `[REDACTED_EMAIL]` markers and a non-zero `redactions` count.
5. **Dashboard** – Commerce Admin → *Error Monitor*: list shows the records newest-first; open one → details (stack, fingerprint, tags, store = Recent/State). Switch *Store* to *Archive* with today's date → same record from Files.
6. **Edge states** – filter by an app name with no records (empty message); stop the monitor's State access or send a bad token (clear error message, no stack traces).
7. **Events** – Developer Console → registration journal: one event for the `critical`/`error` records, none for `warning` (below threshold).
8. **Evidence** – run `npm run smoke`; paste output into `docs/test-results.md` §3.
9. **Resilience** – point the consumer at a dead endpoint: the action still returns its normal result/500 within ~2 s extra at most; nothing crashes.

## 2. Known limitations
1. **Not yet verified on a real workspace/instance** (see test-results §3). Platform assumptions R4 are unconfirmed.
2. **Redaction is best effort** (R2): bare unlabelled secrets and free-form PII (names, addresses, phone numbers) are not detected. Emails and card numbers (Luhn) are.
3. **Recent listing is scan-based** (R3): capped at 500 keys/day and 300 reads/request; ordering is by id; very high volumes will show `truncated`.
4. **No retention for Files**, no purge or compaction (R6); State expires by TTL only.
5. **Single shared HMAC key**, no rotation window, no replay cache (R5).
6. **Org-level dashboard authorization only** – any user in the configured IMS org with a valid token can read records. No Commerce ACL integration.
7. **No server-side rate limiting/dedupe**; the client-side throttle is per warm container and trivially bypassed by non-SDK callers (who still need the key).
8. **Dashboard** has no pagination, search, grouping by fingerprint, or auto-refresh; UI not rendered in a browser during development (logic is unit-tested via the view-model).
9. `schemaVersion` is strict `1.0`; no multi-version negotiation.
10. Package scope `@commerce-ext` and the repo name are placeholders pending approval.
11. **Admin UI SDK V1 is deprecated** (R8): the dashboard must move to `commerce/backend-ui/2` before V1 is removed.
12. On ACCS, the Admin page can't be tested against `localhost`; every UI change needs a deploy to the Stage workspace.
13. The `x-gw-ims-org-id` check is not a security boundary on its own; foreign-org token rejection by `require-adobe-auth` is still to be verified.

## 3. Recommended next steps (priority order)
1. Obtain repo + non-prod approvals; deploy to the ACCS sandbox (or PaaS); run smoke; fix any R4 findings; capture screenshots.
2. Migrate the dashboard to Admin UI SDK V2 (`commerce/backend-ui/2`, App Management) (R8).
3. Security review sign-off (R2) and run SAST/dependency scans (`npm audit`, Snyk, `eslint-plugin-security`).
4. Publish the SDK to the internal registry; pin versions in consumers (R7).
5. Retention: scheduled App Builder alarm action to purge Files after N days (R6); finalize State TTL.
6. HMAC key rotation (accept current + next); optional nonce cache (R5).
7. Server-side dedupe/rate limit keyed by fingerprint; occurrence counter and "first/last seen" in the dashboard (R1).
8. Org-specific redaction patterns hook; allow customers to add deny-patterns without forking (R2).
9. Dashboard: pagination, fingerprint grouping, deep links, auto-refresh; map access to Commerce ACL/roles.
10. Optional: forward `critical` events to the team's alerting tool via an Events subscription (Slack/email/PagerDuty) – no code changes needed in the monitor.

## 4. Hand-off checklist
- [ ] Repo created in approved org; `main` protected; this code pushed
- [ ] Non-prod workspace documented (project, workspace, instance label – no secrets in docs)
- [ ] Secrets stored in the team secret manager / CI secrets (`INGEST_SIGNING_KEY`, `IMS_CLIENT_SECRET`)
- [ ] `docs/test-results.md` §3 completed
- [ ] `docs/review-log.md` – no open blocking items
- [ ] Demo held; attendees and date recorded here: _________
- [ ] Owner/on-call for the monitor named: _________
