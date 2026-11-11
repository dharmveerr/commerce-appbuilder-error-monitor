# Implementation Plan

Legend: ✅ done and verified offline · 🟡 done, needs on-platform verification · ⏳ blocked on approval/environment · ⬜ not started

| # | Task | Depends on | Status | Evidence |
|---|---|---|---|---|
| 1 | Clarify requirements; resolve "six checks vs five bullets" | requester | 🟡 interpretation documented (design §8) – confirm | design §8 |
| 2 | Propose repo name/structure; obtain approval | approver | ⏳ **approval needed** (no repo created) | design §9.1 |
| 3 | Technical design incl. schema, security model, risks | 1 | ✅ | `docs/technical-design.md` |
| 4 | SDK: sanitizer, normalizer, schema, signing, client, `withErrorMonitor` | 3 | ✅ | 22 SDK tests |
| 5 | `record-error` (verify → normalize → State → Files → Events) | 4 | ✅ offline / 🟡 platform | `ingest.test.js` |
| 6 | `list-errors`, `get-error`, output re-sanitization, org pinning | 4 | ✅ offline / 🟡 platform | `query.test.js` |
| 7 | Events publisher (IMS token + `aio-lib-events`) | 5, Developer Console provider/registration | ✅ offline (injected) / ⏳ real provider | `events.test.js` |
| 8 | Dashboard (React Spectrum) + view-model for empty/invalid/error | 6 | ✅ view-model / 🟡 UI render unverified | `viewmodel.test.js` |
| 9 | Admin UI SDK registration action | 8, Commerce non-prod instance | 🟡 contract unverified (R4) | `registration/index.js` |
| 9a | ACCS compatibility review; fix Admin IMS hand-off (`register`/`attach` shared context); correct org-header claim | 9 | ✅ offline / 🟡 platform | `admin-ui.test.js`, design §2a |
| 9b | Decide Admin UI SDK V1 (PoC) vs V2 migration | approver | ⏳ **decision needed** (R8) | design §9.7 |
| 10 | Sample consumer app (separate, SDK only) | 4 | ✅ offline / 🟡 deploy | `sample-consumer.test.js`, `integration.test.js` |
| 11 | Smoke script for deployed workspace | 5, 6 | ✅ written / ⏳ not run | `scripts/smoke-test.js` |
| 11a | Step-by-step setup guide (ACCS sandbox + PaaS) | 5–11 | ✅ | `docs/setup-and-installation.md` |
| 12 | Security review pass (greps, negative control, no secrets) | 4–10 | ✅ | `docs/test-results.md` §4 |
| 13 | Deploy to approved non-prod workspace; run smoke; record results | 2, workspace, credentials | ⏳ | – |
| 14 | Manual dashboard + Events journal verification on Commerce non-prod | 13 | ⏳ | – |
| 15 | Technical review; resolve blocking comments (`docs/review-log.md`) | 3–12 | ⬜ | – |
| 16 | Demo + hand-off | 13–15 | ⬜ | `docs/handoff.md` (script ready) |

**Critical path to "working PoC in non-production"**: 2 → 13 → 14 → 15 → 16.
**Inputs needed from the requester**: repo approval, non-prod workspace + Commerce instance, Events provider/registration and credentials, reviewer names.
