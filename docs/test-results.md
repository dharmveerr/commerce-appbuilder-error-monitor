# Test Results

Run: 2026-11-10 18:05 UTC · Node v22.23.4 · `npm test` (built-in `node:test`; no network, no credentials) · Commit: 1187353

## 1. Summary
| Suite | Tests | Pass | Fail |
|---|---|---|---|
| `packages/error-monitor-sdk` | 22 | 22 | 0 |
| `apps/error-monitor` | 35 | 35 | 0 |
| `apps/sample-consumer` | 3 | 3 | 0 |
| **Total** | **60** | **60** | **0** |

**Scope of this evidence – please read.** These are *in-process* tests: Adobe I/O State, Files and Events are replaced by in-memory fakes that mimic the
call surface the code uses (`put/get/list`, `write/read/list`, `init().publishEvent`). They prove the application logic. They do **not** prove behaviour
against the real services, the Commerce Admin UI, or event delivery. Those are in §3 and are **not yet executed** (no approved non-production environment or
credentials were available to the author).

## 2. Acceptance checks – automated (in-process) status
| # | Check | Result | Key tests |
|---|---|---|---|
| AC1 | Error records normalized to the agreed schema | ✅ PASS | `AC1: normalizes to the agreed schema…` (also asserts code ⇄ JSON-schema key parity), `ids sort chronologically`, `fingerprint groups…`, `caller cannot choose the Commerce instance or record id` |
| AC2 | Recent records retrievable from State | ✅ PASS | `AC2: recent records are retrievable from State (newest first)…`, `filters by severity and application` |
| AC3 | Archived records retrievable from Files | ✅ PASS | same AC2 test (archive list + detail after simulated State TTL expiry) |
| AC4 | Configured Events notification emitted for a tested error | ✅ PASS | `AC1+AC2+AC3+AC4…`, `events: below-threshold…`, `publisher: fetches an IMS token once…`, integration test (exactly one event for the sample-consumer error) |
| AC5 | Dashboard shows error details; safely handles empty / invalid results | ✅ PASS | `AC5: list - ok, empty, invalid, error states`, `malformed rows are skipped and counted`, `detail - ok, invalid, 404`, `empty store…`, `invalid or corrupted stored data…`, `invalid query parameters are rejected…` |
| AC5+ | Admin UI SDK wiring: one section + one menu, valid IDs, same extension ID for register/attach/menu, IMS only from shared context | ✅ PASS | `admin-ui.test.js` (4 tests) |
| AC6 | Sensitive test values not exposed in stored records or dashboard output | ✅ PASS | `AC6: sensitive test values never reach State, Files or Events`, `dashboard API output re-sanitizes…`, `display layer masks…`, integration test scans storage + events + API + view-model |

Note: the brief says "six acceptance checks" but lists five bullets. AC2/AC3 are split here; please confirm (design §8).

### Test-quality evidence
- **Negative control:** with the sanitizer's pattern list emptied in a scratch copy, **11 of 60 tests fail**, including every AC6 test and the integration test — i.e. the leak tests can fail.
- **Defects found and fixed by the tests during development:** (a) `\r` survived sanitization (log-injection risk); (b) `redactions` under-reported because the client masked before the server counted (client count now travels with the payload); (c) a structured-log field overwrote the log event name; (d) app-name allow-list accepted `../../`; (e) found in the ACCS review, not by a test: the dashboard read the IMS token from the URL instead of the Admin UI SDK shared context. Fixed and now covered by `admin-ui.test.js`.
- **Known limitation pinned by a test:** a bare short secret with no label or recognizable shape (e.g. placed alone in a request-id field) is **not** detected (design risk R2).

## 3. Deployed-environment checks – NOT YET EXECUTED
Run `npm run smoke` against the approved non-production workspace and paste results here.

| Check | Command / action | Result | Date | Tester |
|---|---|---|---|---|
| AC1–AC6 + negatives (auth, bad signature, empty, invalid params) | `npm run smoke` | ⏳ pending | – | – |
| Events delivered | Developer Console → registration → Journal / Debug Tracing | ⏳ pending | – | – |
| Dashboard renders in Commerce Admin; detail dialog; empty + error states | manual, with screenshots | ⏳ pending | – | – |
| Platform assumptions R4 #1–#5 (README "Verify on first deploy") | manual | ⏳ pending | – | – |
| ACCS sandbox: Error Monitor listed under *Configure extensions* (Stage) and menu appears | setup guide Part 6 | ⏳ pending | – | – |
| ACCS sandbox: page receives IMS token/org from the Admin (list loads, no "must be opened from the Commerce Admin" message) | setup guide Part 6, step 9 | ⏳ pending | – | – |
| Token from a different Adobe org is refused by `list-errors` | setup guide Part 8, step 3 | ⏳ pending | – | – |
| `aio app build` bundles the workspace SDK (R7) | `aio app deploy` | ⏳ pending | – | – |
| Dependency audit | `npm install && npm audit` (registry unavailable to the author) | ⏳ pending | – | – |

## 4. Security review pass (static, performed offline)
| Check | Result |
|---|---|
| `eval`, `new Function`, `child_process`, `vm`, `innerHTML`, `dangerouslySetInnerHTML`, `document.write` in source | none |
| TLS verification disabled (`rejectUnauthorized`, `NODE_TLS_REJECT_UNAUTHORIZED`) | none |
| Banned crypto (MD5, SHA-1, DES, RC4, ECB) | none (HMAC-SHA256 / SHA-256 only) |
| Secret-shaped literals (AWS/Stripe/GitHub/JWT/private-key) in source, docs, scripts | none (test fixtures assemble synthetic values at runtime) |
| Customer-specific hostnames / names | none; all IDs are placeholders |
| Static analysis (`eslint-plugin-security`, Snyk) | ⏳ not run (tools unavailable offline) |

## 5. Full test output
```

> commerce-appbuilder-error-monitor@0.1.0 test:verbose
> node --test --test-reporter=spec "packages/*/test/*.test.js" "apps/*/test/*.test.js"

✔ registration: one section + one menu, valid IDs, same extension ID as the web app (1.040741ms)
✔ registration action is IMS-protected in ext.config.yaml (Admin UI SDK requirement) (0.320346ms)
✔ readIms: accepts a well-formed shared context, fails closed otherwise (0.771194ms)
✔ page never reads credentials from the URL (they come only from the Admin shared context) (0.41225ms)
✔ cloud event is a valid CloudEvents 1.0 summary without stack (0.801798ms)
✔ severity gate (0.551589ms)
✔ publisher: fetches an IMS token once (cached) and publishes via aio-lib-events (1.425609ms)
✔ publisher: IMS failure surfaces as an error (caller records publish_failed) (0.597589ms)
✔ config: reports names of bad settings, never values (0.44291ms)
✔ AC1+AC2+AC3+AC4: valid error -> schema-valid record in State, copy in Files, Events notification emitted (12.667273ms)
✔ caller cannot choose the Commerce instance or record id (1.155754ms)
✔ AC6: sensitive test values never reach State, Files or Events (even if the client did not sanitize) (2.172196ms)
✔ authentication: unsigned, tampered, wrong key, stale -> 401 and nothing is written (1.41123ms)
✔ validation: bad JSON, bad shape, oversize, wrong method (0.91829ms)
✔ configuration errors fail closed with a generic message (no setting names or values returned) (0.39761ms)
✔ events: below-threshold severity is stored but not published (0.72407ms)
✔ resilience: Events failure and Files failure do not lose the State record (1.828792ms)
✔ resilience: State failure returns 503 (caller can see the record was not stored) (2.508924ms)
✔ events disabled when no provider configured (1.227407ms)
✔ sample consumer -> monitor -> dashboard: one tested error, all acceptance checks, no sensitive values anywhere (10.253899ms)
✔ AC2: recent records are retrievable from State (newest first) and archived records from Files (17.511747ms)
✔ filters by severity and application (2.07995ms)
✔ AC5: empty store returns an empty list (not an error) (0.800321ms)
✔ AC5: invalid or corrupted stored data is skipped / 404, never returned (1.045685ms)
✔ AC5: invalid query parameters are rejected with 400 (including injection / traversal attempts) (0.722484ms)
✔ authorization: wrong or missing IMS org -> 403; instance mismatch records are hidden (3.356931ms)
✔ AC6: dashboard API output re-sanitizes even if a legacy record in storage contains sensitive values (1.996164ms)
✔ archive disabled -> 409 for archive listing (0.261351ms)
✔ storage failure -> 503 with generic body (0.849385ms)
✔ AC5: list - ok, empty, invalid, error states (1.974116ms)
✔ AC5: list - malformed rows are skipped and counted; all-malformed is "invalid", not blank (0.380137ms)
✔ AC5: detail - ok, invalid, 404 (1.004437ms)
✔ AC6: display layer masks sensitive values even if the API returned them (0.682679ms)
✔ markup in records is carried as inert text (React renders text nodes; no HTML sink exists) (0.529477ms)
✔ query builder only emits allow-listed params (0.403932ms)
✔ orders-sync: success path does not contact the monitor (2.051896ms)
✔ orders-sync: failure is reported (signed, sanitized) and caller gets a generic 500 (3.403876ms)
✔ orders-sync: if the monitor is unreachable the action still fails cleanly (monitoring never masks the error) (0.908437ms)
✔ signs and posts a sanitized payload (4.542076ms)
✔ never throws: network failure, HTTP error, timeout, bad config (20.72997ms)
✔ client-side throttle caps an error storm per fingerprint (1.185838ms)
✔ withErrorMonitor: records, returns generic 500 + errorId, passes through success (0.771199ms)
✔ signature: tamper, wrong key and stale timestamp are rejected (0.248951ms)
✔ client reports how many values it redacted so the server-side total is not under-counted (2.512443ms)
✔ AC1: normalizes to the agreed schema and the stored record validates (3.44107ms)
✔ ids sort chronologically (0.473621ms)
✔ fingerprint groups volatile values but separates different errors (0.329467ms)
✔ sanitizes every free-text field and counts redactions (0.599292ms)
✔ allow-list: unknown context keys (e.g. request bodies/headers) are dropped (0.220183ms)
✔ rejects invalid input with details that do not echo values (0.41228ms)
✔ client mode coerces severity, bad timestamps are replaced, size limits applied (0.287881ms)
✔ coerceError handles Error, string, object and junk (0.213551ms)
✔ validateRecord rejects tampered/unknown shapes (1.436702ms)
✔ masks each class of sensitive value (3.787842ms)
✔ drops credentials and tokens inside URLs but keeps harmless params (0.197103ms)
✔ Luhn-invalid digit runs and normal ids are NOT masked (0.138488ms)
✔ counts redactions and truncates (1.013104ms)
✔ strips control characters (log injection) (0.133153ms)
✔ sensitive key detection (0.235192ms)
✔ KNOWN LIMITATION (documented, risk R2): a bare short secret with no marker/known shape cannot be detected (0.084257ms)
ℹ tests 60
ℹ suites 0
ℹ pass 60
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 710.308814
```
