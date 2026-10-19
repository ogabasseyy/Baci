# First-card public activation: source preparation, not deployed

## Completed owner gate

`PREFUNDED_WORKERS_SCHEDULED`, audit `/root/baci-prefunded-workers.8DTV58ja`.
Read-only checks on 27 September at 19:44 and 19:54 UTC confirm recurring
successful snapshot/background invocations and the original signed replay worker.
The five desired checkout SQL definitions and original OIDs match; physical DB
identity is `7685292944002592802`. One credit route, zero operations/intents,
NGN100 customer principal and a separate 10,000-kobo company budget remain.
Reserved and consumed company budget are both zero. All deadlines stay
`2026-09-29T15:59:10Z`. Do not rerun completed installers.

## Public boundary measured

Both staging origins return 404 for the checkout endpoint, CSRF bootstrap and
callback. That is a deployment gap, not a worker-install failure. No card charge,
provider transfer, new signed receipt or financial phone result is claimed.

The dedicated Vercel project is `ogabassey-piggyvest-staging`, ID
`prj_vgV7DiXC52wOhbClB2uzjGAg9IZd`, team `team_P85yMqd79TPq8aSGSt2kojWY`.
Observed alias deployment: `dpl_7qPRHtyJuMbQe2Zfw4y4rfFeQ394`.
**The canonical worktree's existing `.vercel/project.json` targets `baci`, not
this staging project. Never deploy from that link for this task.**

The deployed three-file prebuilt output was recovered through the read-only API.
Every downloaded content UID was verified, then SHA256 calculated:

- Routing config: `50296c2de915494d9551898de0a71387273272f2692952770e6f6697df53c4ce`.
- Receiver function config: `d59e5c086c038354b38007ab8142e3c95db05d02b68ee227e5b7ba05e5f45c94`.
- Receiver code: `37e9b485a83345d0e7b6cdc17b541fbd76a783cc23b597f9b57b1af971a6073a`.

Local recovered baseline: `/private/tmp/baci-first-card-proxy-20260927`.
Candidate routing JSON: `/private/tmp/baci-first-card-candidate-config.json`.
The reviewed TypeScript route transformer in the receiver tree preserves all
19 preceding routes plus the filesystem fallback, adding six rows for only:

- `/api/storefront/customer/savings/card-checkout`: GET/POST/PATCH, other methods 405.
- `/api/csrf`: GET, other methods 405.
- `/savings/card-return`: GET/HEAD, other methods 405.

Saved-card contributions stay unexposed. A failing regression demonstrated the
former transformer also exposed saved-card routes; the corrected transformer
and schema have 17 passing tests. Its live-baseline transformation was checked,
not deployed. Re-query alias and predecessor hashes before any later release.

## Source-only preparation

Luna proved the existing public runtime constructs the real strict checkout
factory and executors; the suspected transformed-profile bug does not occur
there. Tests no longer hide the factory behind a mock. Parent ran the runtime,
context, route and callback tests: 21 passed.

The dedicated `hosted-first-card-checkout` environment profile is separate from
drafts/funding. It restricts staging origins, fixed expiry, maximum 10,000 kobo,
server-only checkout config and disabled saved cards; unrelated credentials are
rejected. This is source only, not installed configuration.

Parent review reproduced the actual Next standalone startup variables in the
environment test. Next injects `NEXT_DEPLOYMENT_ID=''`; the regression failed
before the schema accepted that exact empty value. Nonempty deployment IDs,
unrecognized Next variables and unrelated origins remain rejected. Normalized
standalone metadata is not returned as application configuration or trusted as
payment authority. The future compiled service still needs its own runtime smoke.

`public_service_contract.py` describes a future nonroot, read-only, pinned-image
container publishing only `127.0.0.1:4800` to internal port 3000. It mounts only
the immutable app, projected checkout config and anon config. Its stop timer
retains the fixed deadline and never stops financial recovery/replay workers.
Nine pure contract tests pass. No container, unit or root files were installed.

## Validation and review limits

- Prefunded library/schema, checkout route and callback: 86 suites / 788 tests pass.
- Final environment and real public-runtime regression slice: 5 suites / 133 tests pass.
- Proxy regression/schema: 17 tests pass; pure service contract: 9 tests pass.
- Full canonical and receiver typechecks pass. Changed TypeScript files pass
  scoped Biome. Full lint still fails on existing unrelated files (mobile in
  canonical, other web files in receiver); no blanket lint pass is claimed.
- CodeRabbit refused the shared dirty tree at 209 files against its 150-file
  limit even with a directory argument. Parent review was performed; no
  CodeRabbit approval or full monorepo test pass is claimed.
- No build, root installer, public deployment, payment or provider transfer was
  executed in this preparation round. Local source checks do not prove phone funding.

## Remaining execution work

1. Build and hash a dedicated Next standalone release containing the canonical
   checkout/CSRF routes and callback; account explicitly for callback assets.
   No source `proxy.ts` changes or unrelated route deployment. Do not copy the
   full worker config into this public service or use a service-role credential.
2. Review the root bootstrap/installer that projects the already-protected raw
   `source.publicCheckout`, checks its fixed scope, supplies staging anon auth,
   and proves the actual service environment, TLS and authenticated capability.
   The pure service contract is **not an executable owner installer**.
3. Pin and preserve live Nginx/Vercel predecessors and webhook bytes. Install
   exact public routes only after private proof; rollback withdraws public
   access, never financial records or ongoing recovery workers.
4. Verify public auth, CSRF, amount cap, callback and pending-status handling.
   Then the owner's bounded card test must prove collection, company-wallet
   transfer, original signed provider receipt, exactly-once recognition and
   updated phone balance. A callback or successful empty worker pass is not
   evidence of completed savings funding.
