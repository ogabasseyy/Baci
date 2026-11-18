# Local performance qualification — current-main integration

Latest benchmark status: the user-requested immediate run attempted all 24 cases; 16 produced metrics and eight failed browser readiness. Every measured sample was contention-affected. Raw iframe shifts were captured before the parent visibility proxy; no corrected CLS or clean qualification is claimed. See [benchmark results](./benchmark-now.md). The synthetic order count remains zero.

Latest status: the remaining seven-file free review completed with one minor test finding, now fixed and validated by 10 passing tests. All current runtime files in the follow-up scope have matching review receipts. An additional re-review of the corrected test alone hit the free limit; no clean post-fix receipt is claimed for that test. Benchmarks remain pending by the user's instruction. See [current review status](./free-review-only-status.json).

This evidence concerns uncommitted work based on main `29b41494c9cba1ee3c05c7d51ebc0d84909d7a68`. It is not a deployment or production CWV verdict. Exact changed-file hashes are in `source-binding.json`.

## Implemented boundary

The local composition of the normal MCP upload/build/preview tools invokes fresh gVisor Chromium workers for one concrete route per declared view family, at 390 and 1440 pixels, three cold contexts per cell. The reference profile uses native connectivity, a credential-free minimal host and an opaque sandbox. Each worker observes for two seconds after load. It does not model slow mobile networks, the full Next host, late-session layout shifts, production traffic or field INP.

Qualification requires the complete matrix, median host and frame LCP at most 2000 ms per cell, every host/frame CLS at most 0.1, visible content, decoded viewport images, zero browser errors, and uncontaminated evidence. Missing metrics, infrastructure failures and busy hosts cannot qualify. Functional builds and diagnostic previews remain available when qualification fails. Publication code rejects unqualified evidence before calling the publication service; publication was not exercised here.

Measurements come from a Chromium isolated world with a scoped CDP binding. Candidate main-world globals are not trusted. Readiness also checks the parent iframe and its ancestors. Unsupported out-of-process frame instrumentation fails closed. The controlled reference host uses a same-site hostname; the real Next storefront must be assessed separately.

Reports are signed and bound to merchant, build, source and public render data. Authenticated reads resolve the owner-scoped manifest, recheck fresh normal-RLS bootstrap fingerprints, and recheck the same OAuth scope. Price/content changes invalidate qualification. Ephemeral epochs and remapped asset transport URLs do not invalidate unchanged content. Old evidence stays stored for diagnosis but cannot qualify without current fingerprints.

## Native worker receipts

`native-worker-proof.json` regenerates a synthetic candidate and prerender from the ready local fixture gateway, then runs one 390px reference sample against the final worker. It reports Chromium 153, host/frame LCP 156/444.1 ms, CLS 0/0, visible content, decoded viewport images and uncontaminated metrics. This single informational reference sample is not a full storefront matrix or qualification. `adversarial-native-proof.json` injects fake zero-valued main-world observers and then a real layout shift: the protected collector still measured frame CLS about 0.474, exceeding the gate.

`localhost-host-proof.json` is the earlier invalid diagnostic: it changed the host origin without rebuilding the origin-bound candidate, and reported hidden content/images. It must not be treated as a valid localhost result. `localhost-host-native-worker-proof.json` is the corrected diagnostic: the saved fixture manifest was rebuilt with `hostOrigin=http://localhost:4100`, then prerendered and measured with the existing 127.0.0.1 resource server. It reports Chromium 153, host/frame LCP 168/455.7 ms, CLS 0/0, visible content, decoded viewport images and uncontaminated metrics. This is also one informational reference sample, not qualification.

The composition is explicitly disabled in a production process. A production runner, durable signing/storage, deployment wiring and approval remain separate release work.

## Remaining release evidence

The [24-sample full Next matrix](./local-matrix-2026-10-26.md) completed with zero frame CLS, but all samples exceeded the contention threshold and cannot qualify. The [current-main checkout proof](./current-main-checkout-proof.json) records desktop and mobile final review with decoded images, ₦1,500 synthetic shipping and ₦1,750 total; order count remained zero. Places autocomplete is unconfigured locally and returns 500; manual address entry works. [Validation](./validation.json) records passing checks and the incomplete external review: CodeRabbit disconnected twice, including after partial feedback. A clean matrix and completed review remain required. The [local rollout plan](./LOCAL-ROLLOUT-PLAN.md) has not been executed. Historical intermittent mobile CLS evidence is retained in the earlier frame-speed artifacts; subsequent zero-CLS runs do not erase it. Passing this reference gate does not guarantee that every future custom site will pass field CWV. Each source/data revision needs its own measurements, and production field monitoring remains necessary.

No production data, publication, order creation, payment or paid AI call is part of this work.

## Steps 1–2 follow-up

Current main remained `29b41494c9cba1ee3c05c7d51ebc0d84909d7a68`. The [ten-minute idle preflight](./idle-preflight-2026-10-26.json) found no quiet-start window (two consecutive 20-second samples with load/CPU at most 0.8 and at least 60% CPU idle). Other worktrees were compiling; no unrelated process was interrupted and no new production matrix was launched.

[Free-review follow-up results](./free-review-followup-results-2026-10-26.json) retain completed CodeRabbit reviews of 10 runner files and 19 cart/checkout files, with no critical or major issues. The canonical route input/output mismatch was fixed with a red/green regression. OOPIF auto-attach ordering, cart policy/no-policy paths, checkout missing-merchant/native fallback, and signed-report freshness now have deterministic regression coverage. A style-only request to replace the already strict manual CDP metric parser with Zod was not adopted.

The 23-file gate review was rate-limited by the included free allowance (reported wait: 31 minutes); final follow-up changes also need review. No paid capacity was used. Focused verification passed: 180 Experience/affected cart/checkout tests, 14 runner tests, and Experience commerce/runner TypeScript checks. Step 1 remains blocked on a quiet host; step 2 remains incomplete until the remaining free review succeeds. No commit, push, publication, order or payment was made.

## Private remote authorization and audit

The user authorized a private remote benchmark runner on existing infrastructure, without additional costs or production changes. The [read-only host audit](./remote-host-audit-2026-10-26.json) found only the known production VPS: four CPUs, no runsc runtime or qualified rootfs, denied rootless namespace setup, and no non-interactive administrative access. No runtime, service, firewall, container, checkout or production setting was changed. No remote benchmark was executed. A non-production host/access target has been requested; authorization to use a private runner does not establish that a suitable isolated machine exists.

The remaining [28-file CodeRabbit review completed](./free-review-gate-completed-2026-10-26.ndjson), with two minor issues and no critical/major issues. Both were fixed with red/green regressions: preview authority/report validation now occurs before preview mutation, and a shared canonical-route schema removes the 239/240-character mismatch. Follow-up review of the seven changed files was rate-limited (reported wait seven minutes); no paid capacity was used. Current focused Experience tests pass (65 files / 177 tests), with commerce typechecking and generated contract checks also passing.
