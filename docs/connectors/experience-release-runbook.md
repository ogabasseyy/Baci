# Full-code experience release handoff

This branch supports custom React/TypeScript/CSS and interactions, with Baci as the commerce authority. The experience tools do not generate code through a paid model. Commerce, identity and tenant access continue through the existing clients, schemas and RLS.

## Current activation boundary

The Node boot helper defaults to disabled. A server operator can select only the explicit `local-synthetic` composition with loopback host and runtime origins, normal user clients, a qualified offline build supervisor, a private capture service, an owner lifecycle verifier, public verification and deterministic cleanup. Missing dependencies leave experience endpoints unavailable. No HTTP field, model boolean, environment flag or source package can activate a profile or grant approval. This checkpoint does not add a production profile, publish a connector or apply hosted migrations.

Large MCP source changes use begin/write/finalize chunk upload followed by `read_experience` with `operation: "adopt-upload"`, artifact ID, exact base digest and source version. This uses the existing private source-head RLS transaction; it cannot apply a draft or publish. The 32KiB chunk and64KiB outer request limits remain unchanged.

The restricted verifier can insert proof only; it is not a business-data service-role client. Owner confirmation stays in authenticated owner-web routes with CSRF protection. MCP creates intents and cannot consume them. A committed effect is reconciled on retry before stale/consumed intent checks. Public verification failure leaves a receipt `verifying`; never republish blindly.

## Reproduce local qualification

From the isolated worktree, install only locked dependencies. Use PostgreSQL17 and the already authorized disposable local Linux VM with gVisor, offline rootfs and Chromium/Firefox/WebKit. No paid provisioning or provider credentials belong in the runner environment.

- `pnpm --dir apps/web qualify:experience:release` runs the fixed, credential-filtered release corpus. It stops on a failed gate; inspect and retain that failure, then run later diagnostic gates individually if needed.
- `pnpm turbo lint`, `pnpm turbo typecheck`, `pnpm turbo test` cover the monorepo. These are distinct from the explicit SQL/runner/browser release commands.
- `pnpm --dir apps/web test:experience:sql` replays disposable normal-role SQL fixtures.
- `pnpm --dir apps/web test:experience:lifecycle` runs real PostgREST/RLS upload, offline build, browser capture, native-image evidence and intent/private apply journeys. Public lifecycle transitions occur only inside disposable SQL fixtures.
- `pnpm --dir apps/web test:experience:runner` runs portable runner tests.
- `pnpm --dir apps/web test:experience:browser` rebuilds the locked runtime and runs the complete non-skippable Linux browser matrix, one worker and zero retries. Run this in isolation from broad compiles/builds. Retain every failed/interrupted run; a later pass is separate evidence.
- `pnpm --dir apps/web exec tsx tools/experience-runner/generate-tool-contracts.ts --check` checks all14 opt-in experience MCP wire schemas. Existing eight tools remain the default discovery surface.
- `node --test .github/scripts/experience-runner-ci.test.mjs .github/scripts/resolve-ci-test-plan.test.mjs .github/scripts/resolve-ci-test-plan-config.test.mjs` verifies actual workflow/planner contracts for full and targeted modes. Local contract tests are not remote candidate CI.

Bind evidence to the final source inventory, lock digest, runtime digest and toolchain digest. A dirty source tree has no exact candidate commit. Any commit/rebase/source change requires appropriate refreshed evidence. Do not label a skipped/missing required job passed. The release-manifest builder leaves release/publication/order/payment authority false even when all evidence is present.

## Repository snapshot checks

The cost-inventory regression tests bind the working files to `HEAD`; the dependency-isolation fixture also compares the current lockfile with its committed bytes. Run these checks on the local committed candidate. A dirty-tree rejection is not an operational approval request.

`validateStorefrontEdgeInventorySnapshot` checks a repository regression snapshot and explicitly does not produce release evidence. When this feature changes storefront route/API inventory, regenerate that snapshot with the existing CLI from the committed candidate, inspect the classification delta, and review the accompanying snapshot test. Keep strict source/lock mismatch negatives unchanged. Never substitute this regression snapshot for independently approved operational Cloudflare evidence.

## Lifecycle and rollback

Private apply preserves public state. Publication requires a separate owner intent/confirmation, retained compatible outputs, enrollment/readiness and independent render proof. The live state additionally requires current parent/frame/network markers, exact route/title/canonical expectations, asset digests and independently observed safe journey evidence with zero order/payment requests.

Rollback selects a previously committed retained build under the current policy and creates new publication history. It does not reverse source, payments or orders. Keep a compatible previous artifact/runtime available; absence/pruning/incompatible runtime is a blocker.

Mode exit is explicit: private-draft-only cannot remove an unrelated public experience; compatible-legacy restore requires an already published compatible snapshot; missing fallback needs separately described unpublish-and-legacy-draft confirmation. No mode exit automatically restarts legacy AI. Native and queued legacy writes remain governed by the SQL revision lock and execution lease acknowledgement.

## Stop boundaries

No push, merge, hosted migration, app/submission update, publishing, order or payment is authorized by this local checkpoint. Exact committed-candidate CI, Linux release qualification and any production installation are separate gates. Do not refresh unrelated approved-source/lock manifests to turn a failed repository gate green.


## Local rollback evidence reproduction

`pnpm --dir apps/web exec vitest run --config vitest.experience-lifecycle.config.ts tests/experience-lifecycle/rollback-retention.test.ts` uses two real offline builds in a fresh disposable synthetic database and an ordinary owner Data API client. It retains source/JS/CSS/route captures and runs normal-role trial history/rollback inside a transaction that is always rolled back. It does not alter the running storefront or commit a publication effect. Keep real providers/credentials out of the test environment.

The local archive is `docs/connectors/evidence/experience-checkpoint-d/rollback/`, including its inventory and runtime files. Verify each package's source digest, output/build digests, PNG hashes and exact runtime/toolchain before reuse. Only the local synthetic runtime was qualified. Fixture IDs disappear with their database; activation requires proper retained database history, fresh authorized owner intent/confirmation and independently qualified public observation in the actual installation. The archive grants none of those permissions.


## Performance qualification and release boundary

The implemented local qualification policy is `chromium-native-reference/v1`:
three cold samples per declared route family at 390 and 1440 pixels, a
2000 ms LCP target and maximum CLS 0.1. Build/source/renderer/bootstrap bindings,
content readiness, decoded viewport images and contamination checks fail closed.
MCP exposes starter byte budgets and authoring requirements; missing or failed
qualification cannot authorize private apply. INP 200 ms remains a target rather
than a field-performance claim.

The trusted collector measures the custom frame and its parent in isolated
Chromium contexts. It preserves raw CLS and bounded native shift evidence;
scored CLS excludes only entries strictly before native first paint. Missing
paint timing falls back to raw CLS, and evidence overflow contaminates a sample.
New generated wrappers acknowledge actual React commit before the host presents
the frame. Existing compiled clients retain their legacy handshake and require
a rebuild to adopt the new protocol.

Orbit completed 24 local production-mode diagnostic samples on the earlier
`de0e4a5` baseline. Those used an existing synthetic guest session with cold
browser caches after the normal new-cart quota was exhausted. They do not cover
first-time anonymous bootstrap, were all host-load contaminated, and do not
qualify an updated-main candidate. Keep raw video/HAR and before/after source
bindings; never count loader-only, broken-image or application-error runs.
See [Orbit validation](evidence/experience-performance-qualification/orbit-rebuild-validation.md).

Repeat required source-bound lab and browser checks for the final candidate.
Lab interaction latency or TBT is not field INP. Production CWV needs real-user
75th-percentile observations with sufficient data after a separately authorized
installation. No production installation, publication, orders, payments or paid
AI calls are authorized by these local checks.

Reference: https://web.dev/articles/defining-core-web-vitals-thresholds

## Local private prerender composition

The local-only implementation and exact source-bound receipts are in
[evidence/experience-prerender-mcp/README.md](evidence/experience-prerender-mcp/README.md).
Use `createLocalPrerenderPipeline` to share companion output between the normal
MCP build supervisor and owner preview runtime. Install its `rendering` and
`finalizeBuild` on the local dispatcher, and its owner `createPreviewLaunch`
alongside the existing approval methods. Provide the existing normal-user/RLS
client resolver, verifier receipt callback, vault and fresh public-bootstrap
reader. Never accept renderer bytes or approval flags from MCP arguments.

The compiler and renderer execute only in the offline gVisor profiles. Private
HTML is generated from fresh catalog data before issuing its immutable resource
ticket. Resource leases remain short-lived and revoke on real grant/session
changes. Without `artifactDirectory`, companion output uses the bounded 32-entry/64MiB
in-memory LRU, so eviction or process restart requires a fresh build. With a
trusted private `artifactDirectory`, integrity-bound companion output survives
restart under the durable store limits; missing or corrupted output fails closed.
Private shopping remains the existing simulated Baci preview dispatcher.

This composition is disabled in production. Single-host local durable public
artifact retention/delivery is implemented; it is not replicated production
storage. Hosted installation, final-candidate qualification and all existing
submission/review/release gates remain separate. Do not publish, create orders,
submit payments, apply hosted migrations or invoke paid AI providers to qualify
this local path.
