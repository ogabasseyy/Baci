# PR 3993 review corrections — 2026-11-03

Review base: `6b9b0b362d5bb47a23160a3a176487ae50feb9f8`.
CodeRabbit remains skipped by owner instruction. These corrections require fresh GitHub review/CI; prior receipts do not approve the changed candidate.

| Finding | Correction / regression evidence |
| --- | --- |
| Owner-web publication bypasses MCP performance gate | Shared publication service checks fresh, build-bound qualification for requests and rechecks before owner confirmation. Owner composition receives the same trusted performance reader as MCP. Missing/failed reports reject before requesting or confirming an intent. |
| Cart observer quota becomes permanent after 64 operations | Evict only settled observers when capacity is needed. In-flight entries remain bounded/protected; receipt storage is not cleared. Regression completes 80 operations with an in-flight observer retained, and separately denies a 65th all-in-flight operation. |
| Home-only experience replaces native PDP | Check ownership of the already native-resolved canonical product route. Regression verifies home-only/editorial-only experiences do not claim PDPs and the actual categorized page continues through the native product loader. |
| Semantic fallback leaves a path-based merchant | Bind retained relative links to the trusted launch canonical base. No authored markup or executable links are admitted. |
| SDK navigation bypasses channel epoch tracking | Route updates use `channel.send`; regression exercises a valid SDK request and expects the epoch-2 route through the tracked channel. |
| Dynamic route regular expression warning | Match normalized, bounded path segments directly instead of constructing a regular expression. Preserve literal bracket and named-segment behavior. |
| Experience tsconfigs missing from normal typecheck | Append the existing experience typecheck task to the web typecheck script. The previously failing CI contract passes. |
| Publish scope downgraded to read RPC | New append-only `experience_authorize_publish` RPC rechecks live publish scope under the existing normal-owner/session/connection lock. Normal Data API test denies read-only, wrong-owner, anonymous and revoked connections. No hosted migration was applied. |
| Browser preparation assumes a local Colima installation | Explicit macOS/running-Colima preflight fails with a prerequisite explanation before any build/provisioning command on unsupported hosts. Native deployed execution remains the separate Linux runner. |

Semgrep's two additional parser diagnostics were also addressed without exclusions or policy changes: explicit named type exports replace `export type *`, and a test mock uses an equivalent type assertion instead of an unsupported generic import-call syntax.

Validation: 78 focused Vitest tests across 15 files; 6 Node contract/prerequisite tests; one disposable normal-auth/RLS database test. Experience runner/authoring/commerce TypeScript scopes and targeted Biome checks passed. Standard commit/push gates and fresh GitHub CI remain independently required.

The preceding CI head also failed the separate WebKit repair-pickup simulation at address selection/quote visibility. Main's corresponding run passed. That failure is not attributed to a cause yet and is not hidden or converted into a performance pass; retain the failure artifacts and inspect the fresh-head rerun if it persists. No repair/payment runtime change is included in these corrections.

Benchmarks remain parked. No deployment, storefront publication, real orders, payments, service-role commerce or paid AI reviews occurred. Existing installation/checkout/benchmark receipts remain historical and must not be relabeled as qualification of this changed source.

## Follow-up: checkout, projection ordering, replay capacity and tenant quotas

- A throwing published-head load now falls back to the merchant's native checkout. Both native template selections have regression coverage.
- Append-only migration `20261103203000_experience_public_manifest_order.sql` orders all three public JSON aggregates by authored ordinality, preserving route precedence. Public projection joins, grants and private-data exclusions are unchanged. Disposable PostgreSQL verification uses the anonymous read role; no hosted migration was applied.
- Replay admission retains every unexpired consumed nonce, with independent 4,096-entry owner/public lane budgets. Capacity returns 429; replay/invalid binding remains 409. Tests cover 1,100 signed requests in one window, expiration, 4,096 public admissions, reserved owner capacity and cross-lane replay. Replicas still require independent keys or a shared replay ledger.
- Preview admission uses authenticated merchant identity, an eight-launch/32 MiB tenant ceiling and the existing 32-launch/64 MiB global safety ceiling. Byte accounting includes pending launches, rewritten CSS and replacement prerender HTML. Resources stage atomically, with separate tenant/global metadata bounds. Two-merchant tests cover launch saturation and retained-byte prerender saturation.
- Focused verification: checkout/preview initial regressions failed before the fixes; runner throughput failed at the former 1,024 cap. Final checks include 19 runner transport tests, 16 preview/launch/migration-registry tests, 14 checkout/preview-reader consumer tests, 6 final quota tests, 5 prerender compilation tests, one disposable SQL projection test, and three experience TypeScript projects.
- CI's three Mac/Colima/gVisor installation and HTTPS qualification tests now require explicit `BACI_LOCAL_EXPERIENCE_QUALIFICATION=1`. They are skipped in ordinary unit CI, not counted as qualified. Run them deliberately with that variable and the provisioned fixture; benchmarks remain parked. A stale source assertion now checks the emitted JSON readiness options.
- No deployment, publication, orders, payments, hosted data changes or extra review-provider calls occurred. Remaining GitHub review findings and exact-head CI are separate release gates.

## Remaining review threads (November 4)

- Home-only experiences leave native product reads intact. Catalog membership no longer implies ownership of a PDP: persistent shells retire on native destinations, and SDK navigation hands them to the Baci router without waiting for an experience boundary.
- Checkout survives a corrupt custom head at both page and parent-layout boundaries, with path- and domain-routing regressions. Other unavailable custom routes still fail closed.
- Measurement and retained-evidence readers now validate categorized canonical PDPs through the canonical resolver and fresh catalog bootstrap fingerprints. Bootstrap validation lives in a focused helper; the measurement module is below 300 lines. All measurements in these tests are mocked; no benchmarks were run.
- Owner intents, public catalog selection and preview status schemas live under `src/schemas`. Omitted preview route locators select the first route of the authorized stored manifest, including product-, collection- and editorial-only builds; explicit missing locators still fail.
- The evidence client accepts an explicitly trusted HTTPS backend origin for synthetic/staging composition, retaining the fixed evidence path, bearer handling, manual redirects and bounded image reader. Preview status authenticates before parsing the locator. The installed Zod 4.6.6 runtime exposes and successfully executes `z.fromJSONSchema`; the contrary review assertion does not apply.
- Candidate migrations are registered in an additive replay-registry folder. Frozen baseline inventories are restored to current main's bytes. The anonymous-definer exposure test documents exact existing public projection/attested-quote signatures rather than changing grants.
- Public experience reads use the standard anonymous limiter's separate 240/min namespace, without importing cart credential-signing authority. Launch JSON uses the existing bounded-body helper. Fallback styles use the existing global sheet, preserving the native PDP's four-sheet source budget.
- Scoped local results: 57 route/frame/performance tests, 43 CI-regression/helper/registry tests, 10 schema/owner-runtime tests, eight CSS/route-boundary guard tests, and one authenticated create/edit disposable-DB test passed. The full repository authority scan was run while files were still being edited and reported missing new schema test files; both files now exist and are staged for CI. Database replay, exact committed inventory and fresh-head CI remain final gates. No CodeRabbit, deployment, publication, orders or payments.

## Codex/Muse follow-up on 7072162229 (November 4)

- Experience-unowned routes now render the native layout and providers inside the persistent shell. Home-only custom stores retain native wishlist/saved-items/PDP behavior. Private preview navigation commits matched product/collection handle parameters.
- Cart adds can resolve current trusted products beyond the initial 100-product bootstrap under the existing `catalog.read` capability. Admission is rechecked after the lookup before the normal shared cart port is used; unavailable or revoked lookups never submit commands. Variant-parent availability follows purchasable public variants, including serialized-then-unlimited variants at zero scalar parent stock.
- The RLS catalog loader takes the existing trusted product-image map directly. Production runtime forwards that map instead of patching images afterward; a loader regression verifies assetId and alt text.
- Report-retention tests cover success, absent report/storage, storage failure and authorization failure. A missing report cannot claim measured evidence. All five experience TypeScript projects (runner, authoring, commerce, durable, performance) are now in the normal typecheck contract.
- Execution-origin framing is limited to storefronts and the explicitly recognized builder-experience subtree. Other admin, auth and API policies do not gain the authored-code origin.
- Private preview HTML has no CORS read grant. Ordinary unconfigured Origin requests are rejected; only configured host origins or the sandbox's required opaque-origin subresource requests receive matching CORS headers. `Origin: null` is not authentication: resource URLs remain independently scoped, expiring bearer capabilities backed by vault/RLS liveness. Published output remains deliberately public. CORS alone cannot protect a leaked bearer URL against a non-browser caller or another opaque sandbox; no stronger confidentiality claim is made.
- Generated bundles, screenshots and raw review logs (56 files) were copied to the operator's private local `pr3993-binary-evidence-20261104/historical-generated-evidence.tar.gz`, verified against per-file SHA-256 before removal from the final git tree. `historical-generated-evidence-archive.json` records the archive and file digests. Source and receipts remain in git; rollback outputs and future generated evidence are ignored. This is historical evidence, not current qualification or a public artifact upload.
- Current-head CI's missing usePathname test mock is corrected. Its Docker authenticated-edit RPC failure remains an outstanding CI diagnosis: native local PostgreSQL previously passed; this attempt could not reproduce it because the local Docker fixture database did not become ready. The synthetic proxy now emits only SQLSTATE on a failing finish RPC, never credentials, bodies or database details. Do not call that integration gate green until the new CI result confirms it.
- Focused layout, cart, navigation, stock, retention, CSP and delivery regressions plus the five-project typecheck and four Node contract checks are used here. Benchmarks remain parked. No CodeRabbit, deployment, publication, orders, payments or paid AI calls were initiated.

Native-route and response-policy follow-up: product ownership cannot capture `/cart/experience`; its native layout/providers are retained. The private-builder frame allowance is applied to both the forwarded request CSP and final response CSP, so narrowing admin policies does not break owner previews. Their regressions failed before the fixes and pass afterward. The new fixes are reconciled with main `21f52993f8`; source-bound inventory/provenance is regenerated after the merge. The synthetic edit-fixture diagnostic includes only numeric HTTP status and validated SQLSTATE.

Current-main reconciliation: main `72f1a3290f` (Oxygen checkout) is included in merge `baed1d1a7ff89359fa2d0eec810722237cfad091`. Existing owned-order resume occurs before published-experience loading; malformed heads still fall back for ordinary checkout. Main Oxygen hosted-origin restrictions remain intact alongside the scoped builder frame allowance. Six checkout/CSP test files passed (60 tests), plus two Oxygen policy files (13 tests), all with mocked payment paths. No order or payment was performed. Inventory/provenance is refreshed against the merged runtime. Current-head CI confirmation remains required.

## Codex follow-up on b6669f5f0756 (November 4, 12:18 UTC)

Source commit `18b1f6093f9b2f30e5699e7ffb0e03e365d80535` resolves fetched product navigation through the trusted public catalog endpoint before selecting native/authored ownership, rejects stale lookup results, normalizes nullable database images, excludes collection documents from both PDP preflights, and paginates immutable upload chunks beyond 128 rows under merchant/upload/path filters. Nine private-capture tests exercise normal owner authorization, merchant/build query binding, replay/conflicts, unavailable builds/artifacts, origin/job checks, capture/persistence failure retry and revocation before persistence.

New behavioral regressions failed before the fixes. Final affected/adjacent scope: nine Vitest files, 45 tests passed; all five experience TypeScript projects and changed-file Biome checks passed. No real capture runner, order/payment or external provider request is used in these tests. Broad web push typechecking previously failed with TS2589 in generated/native Next typed-route consumers; that gate and exact-head CI remain unconfirmed. No CodeRabbit; benchmarks remain parked and production composition remains disabled.

## TS2589 compiler fix (November 4)

Source `de42aaa4b3ee4f26199608aac9438ef4af23b2ca` includes main `0e842c0393`. The normal web typecheck now runs a deterministic preparation after Next typegen: it skips the dynamic inference branch only for T wholly covered by the existing static/search/protocol branches. This is type-equivalent and leaves Next's dynamic validation and exported signatures intact. Unsupported generated shapes fail closed. The hover-prefetch wrapper derives concrete base DOM/Next props while preserving a Route/UrlObject boundary, and explicitly instantiates its inner typed Link. No runtime URLs, prefetch behavior or commerce/auth boundaries change.

The original typed-link repro and full web tsc gate failed with TS2589 before the fixes; full web tsc passes after them. A normal-gate compile-time fixture accepts checked routes, inferred product links and URL objects while rejecting unchecked strings and invalid literals in Link, hover links, push/replace/prefetch and redirects. Generator and hover-link tests pass (10 tests), script contracts pass (4 tests), all five experience TypeScript projects pass, and changed-file Biome checks pass. Earlier failed experimental declaration overloads were discarded. Current-head push/CI checks remain required. Benchmarks are parked; no CodeRabbit, deployment, publication, orders, payments or paid AI calls.

## Review follow-up on 2f667f631d (November 4)

Source `6ae86ee01c8582f21e63770bf29fb9ae11ea31c3` includes main `6e359d04f8`; inherited PiggyVest code remains at its existing rollout settings with no production action. All six Codex findings are addressed:

- Colocated gateway tests cover auth syntax/failures, scopes, stable-identity throttling, invalid/oversized input and results, safe errors and successful admission.
- Native repair, auth, compare and reserved route families retain native layout/providers. Categorized product candidates follow the storefront routing exclusions.
- Preview launch accounting includes unexpired resource binding IDs after one-use references are consumed; pending-reference, per-tenant, byte/resource and global safety limits remain enforced. Revocation/expiry release capacity.
- Private apply accepts the capture ID actually returned by the preview tool and resolves its merchant/build/digest/job/attempt/origin-bound attestation using the normal owner RLS client. SQL remains the final effect authority. The real MCP lifecycle test uses preview.evidenceId directly instead of querying another evidence ID out of band.
- Publication retries with SQL-certified committed receipts reconcile and finish verification without requiring fresh/retained performance evidence. Uncommitted approvals still require qualification; missing receipt authority fails closed.
- Public variants come from the existing anonymous-safe commerce RPC, which excludes inventory anchors and returns effective policy/availability. Owner-only metadata rows are no longer required to retain a public variant. Loader tests cover ordinary stock and serialized-then-unlimited variants with RLS-empty private metadata.

Jules' server-component advisory is corrected with JSX in the three storefront pages; native page unit tests inspect the supplied fallback while boundary tests cover RSC behavior. CI fixture repairs separate anonymous shipping spies from admin spies, preserve the narrowed auth/admin CSP, keep compile-time navigation tests under the normal tsc gate, and split the runtime-suite registry without losing any of its 173 associations.

The earlier CI builder edit failure reported SQLSTATE 40001. A deterministic regression demonstrated finalization racing a settled provider acknowledgement on the shared website guard. Successful generation now waits for acknowledgement; timeout cleanup stays attached to the actual provider promise. The regression failed before the fix and passes afterward.

Validation: all 100 tests across the 16 affected default-suite files pass; the focused repository authority contract passes. The native local PostgreSQL/PostgREST authenticated create/edit proof and the real MCP lifecycle proof pass. The MCP proof asserts zero published heads and zero AI-provider calls. A Docker PostgreSQL 17 attempt could not start its local database fixture, before reaching the test body; exact Linux CI confirmation remains pending. Fresh generated MCP proof artifacts are retained only under ignored `.superpowers/sdd/experience-mcp-current-proof/`, preserving the archived historical evidence. No benchmarks, CodeRabbit, deployment, hosted migrations, storefront publishing, orders, real payments or extra AI-provider calls were performed.


## 5 November: current-head CI and subsequent reviews

Source commit `4af8927598598c4305f6eab54f27751c20428f18` addresses the three subsequent Codex findings and Jules's low-severity approval typing suggestion. Added colocated effect/scope/auth/RPC mode-exit tests and extracted the strict source-patch schema. MCP build finalization alone receives a finite 300-second budget, aligned with the backend route; ordinary tools retain 25 seconds and caller cancellation remains effective. A deterministic 36-second build regression failed under the previous transport and passes with the fix. No benchmark was run.

The four failed CI shards exposed stale fixtures: normal public shipping RPC client, the capture lookup before private apply, and client renderers attempting async RSC composition. Fixtures now explicitly model those boundaries, preserving the dedicated server-boundary behavior tests. Ten focused files / 76 tests passed before adding the standalone schema contract; inventory/schema checks are recorded separately. Fresh pushed-head CI remains required. No CodeRabbit, deployment, hosted migration, storefront publication, orders, payments or provider calls.


## 5 November: related-link and owner-request review

Source `73c0e82513a5af133d8f65d657d62ff4aec362e4` shares trusted catalog destination resolution between same-tab navigation and new-context link presentation. The latter can present a related categorized product absent from the initial bootstrap without changing the current page. Missing products and stale catalog replies fail closed. Added direct owner-request session/merchant/ownership/RPC denial tests. Seven focused files / 30 tests pass.

Jules's high finding about unavailable `z.fromJSONSchema` is not applicable to the installed Zod 4.6.6: local runtime confirms both `z.fromJSONSchema` and `z.core` exist, and a new colocated MCP experience-contract test imports/converts the wire schemas and verifies strict parsing. Kept the supported converter; grouped the categorized PDP CSS imports for the low advisory. Previous-head checkout browser regression passed; CI Quality Gate was still in progress when this follow-up was pushed. Jules review failed on the incorrect library claim. Fresh-head checks/review remain required. Benchmarks parked, CodeRabbit skipped; no deployment, hosted migrations, publication, orders, payments or provider calls.


## 5 November: pagination envelope and runtime-profile validation

Source `200cd9f607840019383848b03326666c0f1bfef8` budgets the complete `{ status: 'ok', value: page }` envelope during source pagination, matching the dispatcher's 98,304-byte admission cap. The escaped-control regression reproduced a 98,324-byte result before the fix, then passed while round-tripping the full control-character/UTF8 source with progressing byte cursors. Dedicated profile-validation tests cover production/local success, disabled local production profiles, non-loopback and malformed local origins, cross-site production isolation, and missing lifecycle/build/preview ports. Three affected files / 18 tests passed (including composition); normal pre-push typecheck and current-head CI remain separate gates. No CodeRabbit, benchmarks, deployment, publishing, hosted migration, orders, payments or provider calls.


## 5 November: live canonical identity and tool schemas

Source `b4e2c285f40d59a5c59b89fec5cc364053b7fd8b` uses `buildStorefrontPdpCanonicalPath` for experience catalog projections, preserving current category joins while ignoring stale stored `canonical_url` values. The stale-category regression failed with `/old/device` before the fix and now resolves `/new/device` for both direct and joined category identity. Existing category aliases normalize consistently with proxy preflights (`phones` to `smartphones`). Added colocated tool-input tests for read/patch/adopt discriminants, unsafe paths, source/chunk size boundaries, encoding constraints, lifecycle versions/IDs and strict fields. Four focused suites / 29 tests passed. Current-head CI/review and normal pre-push checks remain separate. Benchmarks parked, CodeRabbit skipped; no deployment, hosted migrations, publishing, orders, payments or provider calls.


## 5 November: recovery and quote-only review findings

Source `f1566a2a55b698de53ccd674b9c4979209941b43` addresses five subsequent Codex findings: extracted independent-verifier evidence schemas with direct validation; verification-only retry of committed publication receipts both immediately and on reload, using the existing approval ID; mode-exit schema boundary tests; SDK cart reconciliation through the normal admitted host command port with original operation IDs preserved across timeouts; and merchantless domestic carrier quote-only support without tenant persistence or read capabilities. Merchant-bound storage/attestation remains required.

The prior merchantless quote and approval-reload regressions fail against the previous implementation and pass after the fix. Twelve web suites / 39 tests and two SDK suites / 11 tests passed; shared/SDK typechecks passed. All external services mocked; no actual quotes, publication confirmations or cart writes were sent. Guidance now tells generated code to reconcile an indeterminate operation rather than send a fresh mutation. Current main's Chatwoot test exclusions were combined with experience exclusions during merge. CI/full package coverage and pre-push typechecks remain separate gates. Benchmarks parked, CodeRabbit skipped; no deployment, hosted migration, publishing, orders, payments or extra AI calls.


## 5 November: BOM preservation and publication-schema review

Source `51d3887f919fa000cf9d29b06a8ffe7d26ef2cdf` preserves the UTF8 BOM during fatal decoding of verified upload bytes. The byte-preservation regression failed before the change; final tests also verify the BOM is retained in the canonical manifest sent by `finalizeUpload`, while malformed UTF8 still fails. Added colocated publication/approval schema tests for identifier/action/version boundaries, strict requests, approval references and lifecycle status defaults. Five focused suites / 30 tests passed. The two blocking review conversations are to be resolved only after pushing these fixes; fresh CI/review and normal pre-push typechecks are separate gates. Benchmarks parked, CodeRabbit skipped; no deployment, hosted migration, publishing, orders, payments or provider calls.


## 5 November: responsive preloads and route-bound owner preview

Source `7732185e16f512d6a7c35124f606555638f35b10` validates href-less React responsive image preloads against trusted asset candidate URLs and valid width/density descriptors. Untrusted or malformed candidates fail closed. Extracted public-output file and prerender-binding schemas into the schemas directory with direct tests. Private capture links now carry the requested route through the page, sign-in return and interactive launch request; omitted routes keep the existing default.

The responsive React SSR, non-default capture URL and launch-body regressions each fail against the previous implementation and pass after the fix. Eight focused suites / 38 tests passed, including existing public-output reader binding checks. Current main through `b042dfbc6d` merged cleanly; its provider infrastructure is not activated. Normal pre-push typechecks and fresh exact-head CI/review remain separate gates. Benchmarks parked, CodeRabbit skipped; no deployment, hosted migration, publishing, orders, payments or extra provider calls.
