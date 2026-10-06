# Isolated staging progress — 15 September 2026

## Current status: certificate installed, application access still disabled

- The owner installed the reviewed certificate-only TLS virtual host. Public
  certificate verification succeeds; application requests intentionally return
  503. Earlier DNS/certificate blockers below are historical, not current.
- Rechecked the four isolated containers: DB, Auth, REST and Mail are healthy.
  Firewall service remains active. Noninteractive sudo is unavailable; the
  dedicated gateway user/group are not yet provisioned.
- Managed gateway source now uses a permission-controlled Unix socket, an
  explicit bounded operator lease, fresh startup evidence and live inventory
  checks. Independent review found inspection occurred before binding validation;
  this is fixed with 12 red-to-green regressions. Actual non-root Linux Unix
  socket/TLS rehearsal passed, including socket withdrawal on unhealthy inventory
  and zero requests to a live TCP-port decoy. Public TLS remained 503 before and
  after; all disposable test processes/files were removed. VPS systemd is 255.
  Installed systemd/sudo enforcement still requires the owner-run root step;
  the non-root rehearsal does not establish that privilege boundary.
- Mobile hosted entry now installs the pinned isolated runtime before loading
  the normal router. Development manifest verification rejects mismatched keys,
  origins, tenants, release builds and conflicting modes. Financial activation
  remains disabled. A physical-device hosted journey is still outstanding.
- Do not announce provider readiness: public application routing, hosted app
  login/savings validation and PiggyVest financial sandbox validation remain
  separate incomplete gates. No provider message has been sent.

## Latest continuation: HTTPS rehearsal and mobile dependency wiring

- Rechecked all four isolated VPS containers healthy, with no host-published
  ports; the staging firewall service is active. `sudo -n` still fails.
- Added disabled-by-default public ingress generation, exact route/method/CORS
  restrictions, originless native request support, bearer forwarding without
  cookies, and generic upstream failure responses. No shared Nginx reload,
  certificate installation, DNS change or public activation occurred.
- Actual nginx 1.30.3 parser and loopback TLS rehearsal passed on the VPS using
  a synthetic upstream and temporary test certificate trusted only by the test
  client. Native POST, browser preflight, foreign-origin/admin/signup denial,
  cookie suppression, error redaction and backend-down 503 were verified.
  Both owned listeners were closed after the test. This is not public TLS proof.
- Rehearsed generator SHA256:
  `15c7682d4e7c8ba1749e4626f5a201a8c73c7c568f1fb466ef05b996c38b6498`.
  Reusable harness: `tools/staging/isolated-savings/https-loopback-rehearsal.test.mjs`.
  It skips unless explicitly opted in on Linux as a non-root user.
- Parent verified 14 ingress/access-check tests and 138 mobile hosted-runtime,
  startup, Supabase and isolated-storage tests. Root lint/typecheck both pass.
  The earlier unrelated full-suite integrity failures are not superseded by
  these focused results. The manual loopback harness has one Turbo environment
  declaration warning; it is run directly, outside cached Turbo tasks.
- Mobile dependencies now consume an installed verified runtime, but normal
  startup still needs its early installer/config branch and reviewed key pin.
  Do not describe it as ready to launch on the phone. A build-pinned public-key
  SHA256 plus exact reviewed origins/issuer/merchant can provide configuration
  identity; a separate signing service is not required for this fixed dev build.
- All six live read-only hosted-access probes returned no HTTP response; DNS
  still has no A record for `staging-auth.ogabassey.com`. Cloudflare redirected
  to login. The owner was asked to sign in and agreed to run a reviewed root
  installation command when ready. No command should be advertised as ready
  before DNS/certificate and persistent-supervisor prerequisites are addressed.
- PiggyVest financial end-to-end processing remains unverified and disabled.

## Verified on the VPS

- Rechecked the installed 1,165-entry schema receipt and healthy owned services.
- Created exactly two synthetic accounts through the official isolated Auth API.
  Passwords were randomly generated and not retained; no credentials were printed.
- Ran the catalogue fixture rollback rehearsal successfully, then committed it.
  Current counts: two Auth users, one merchant, one customer, one product,
  two exact variants and zero customer wallets. All feature booleans remain false.
  Receipt: `/home/bassey/baci-isolated-savings/fixture-committed-receipt.json`.
- Started the unprivileged private routing supervisor with fresh inventory.
  Anonymous user endpoint returned 401; admin and signup returned 403;
  allowed catalogue returned 200; unknown routes returned 404.
- Requested a synthetic login message through the private gateway. Mailpit
  captured it internally. Verification returned 200 with the exact isolated Auth
  issuer and authenticated role. No token or email body was printed. This tests
  the private gateway and Auth service, not the phone or public staging domain.
- Stopping owned Auth/REST services for maintenance caused the supervised private
  listener to disappear. Shared Nginx and other VPS services were not changed.
- The first rollback-only hosted-draft authorization rehearsal passed against
  the real isolated database. It left no installed migration, binding or settings.
  Extended hosted create/reload/consent coverage remains in progress.

## Local implementation

`provision-synthetic-auth.mjs` has five passing synthetic tests and a clean Biome
check. It creates only the two `.invalid` identities, retains only their IDs and
emails, uses a short-lived administrative token, and never retries an indeterminate
creation. The parent wrapper binds execution to the reviewed container/network
and refuses existing Auth users before provisioning.

The new mobile hosted runtime installer connects profile validation, guarded
fetch, isolated storage and Supabase client construction. Its agent reports 93
focused tests plus three bootstrap tests passing. Startup remains disabled until
the verified runtime profile is consumed by the normal app entrypoint. This does
not enable funding, interest or canonical savings activation.

Parent root lint and typecheck exited 0; existing lint warnings remain. These
checks do not establish a full-suite or deployed end-to-end pass.

## Not yet established

Public Auth DNS/TLS, persistent public gateway, Vercel app deployment, normal
wallet-screen hosted login/draft journey, and PiggyVest financial sandbox delivery
remain unverified. No production data, production credentials, real funds or
provider API calls were used. No external messages were sent.

## Completed private hosted-draft validation

The expanded real-database rollback suite passed, including both exact variants,
server-owned prices, create/reload, request replay, consent and acceptance replay,
invalid variant/price/consent/revision/hash rejection, wrong-account/merchant and
unauthenticated denial, and continued canonical-activation denial.

The append-only hosted-draft migration was then installed on the isolated VPS,
SHA256 `afc8604739b84da0af6d61d7c75b720dae09c064ac37a64c254d350bfdb1a80f`.
It adds no enabled bindings by itself. A separate administrator action bound only
the synthetic customer to the synthetic merchant for draft testing, with explicit
synthetic disclosure text. Canonical savings and financial features remain off.
The prior 1,165-entry replay receipt describes its original manifest; this
additional migration has its own `hosted-draft-migration-receipt.json` receipt.

Using the actual synthetic Auth session over the supervised private HTTP gateway,
the customer created an exact-variant draft, replayed the request, reloaded the
same single draft, accepted the test disclosure and replayed acceptance without
changing the timestamp. Anonymous requests returned 401 and another merchant
returned 403. Receipt:
`/home/bassey/baci-isolated-savings/http-draft-0915-receipt.json`.
This is an actual private API journey, not a browser/phone UI or provider-money test.

Parent verified 91 mobile profile/installer/fetch tests. The full repository run
found two startup harness failures (6,230 mobile tests passed); the harness was
fixed to load the real hosted guard rather than an unrelated stub. The agent
reports 13 startup tests passing afterward. Full-suite success after this fix
still requires a rerun.

Public ingress remains blocked: the latest DNS lookup returned no A record for
`staging-auth.ogabassey.com`, and `sudo -n` is unavailable for the VPS account.
No public Nginx staging site was present in the inspected enabled-site names.
Public TLS/ingress will require the reviewed owner-run privileged step; the
existing five-minute private supervisor is not an unattended production service.

Parent subsequently verified all 13 startup tests and reran root lint/typecheck;
both exited 0. A fresh full-root test run is in progress and is not yet a pass.
The temporary private gateway was explicitly stopped after testing; its loopback
listener is closed. All four isolated Docker services remain healthy. This avoids
leaving a temporary ingress process mistaken for the eventual persistent gateway.

The fresh full mobile run now passes: **1,038 suites, 6,253 tests**. Shared,
mobile-admin, TikTok and qualification-worker test tasks also passed. The web
task is still running; root-suite completion is not yet established.

## Review follow-up

CodeRabbit completed its uncommitted tracked-file review with six findings, not a
clean verdict. Its reviewed-file list did not cover every newly untracked file.
The relevant major findings were addressed with regression coverage:

- Valid variant-price overrides now remain selectable when the product's base
  price is absent/invalid; invalid effective prices still fail closed.
- Completed unresolved selections without resolution options expose Change device
  and open the replacement modal, while completed-goal top-ups stay unavailable.
- The legacy savings screen was extracted into its own tested component.

An unsupported variant-resolution response status now has negative coverage.
The proposed web fallback for an explicitly present invalid staging payload was
not applied: existing tests intentionally prevent fallback into legacy funding,
and the real wallet page does not pass `stagingSavings` for normal customers.
The remaining UUID constant suggestion is nonblocking style-only and deferred.
These review fixes postdate the full mobile pass above; focused post-fix checks
and final lint/typecheck are being verified separately.

Parent post-review checks passed: 46 focused tests across the five changed mobile
suites, eight response-schema tests, root lint and root typecheck. The lint run
retains 20 existing mobile warnings. No review fixes were shipped to production.

## Final validation result

The full root run completed with a failing web task: 5,618 web test files passed,
eight failed, 34 skipped; 35,607 web tests passed. Five failing replay-registry
suites were caused by the newly added hosted migration missing its explicit
registry entries. Parent reproduced the missing-entry failure, pinned the exact
migration hash in both source registries, and reran all five suites plus the
savings registry regression: **six suites, 107 tests passed**. Final root lint
and typecheck also passed after that correction.

Three unrelated web suites remain failing from the full run: the two Cloudflare
process-isolation suites require a lockfile matching their approved commit, and
the storefront edge-inventory suite requires its approved source tree. Their
integrity gates were not weakened and others' lockfile/worktree changes were not
reverted. No full-green root-suite claim is made. Full-run log:
`/private/tmp/piggyvest-0915-final-tests.log`; targeted registry rerun:
`/private/tmp/piggyvest-registry-green.log`.
