# PiggyVest goal funding — staging connection

## Scope

This connects PiggyVest sandbox bank funding to the existing manual savings
goal. It does not settle Paystack card payments into PiggyVest, change the
production wallet, enable customer interest, or authorize real transfers into
a sandbox account. Provider acceptance is not treated as settled funding.

## Interest opt-in correction — 1 October 2026

The original phone goal wallet was created with `enable_interest_accrual: false`.
The provider's business-level 9% customer rate and 3% business split do not
verify the existing wallet's accrual flag. The live wallet read exposes
`interest_enabled`, not the creation request's `enable_interest_accrual` field.
On 1 October the phone wallet returned `interest_enabled: false` and a current
interest rate of zero. The public creation documentation does not specify an
endpoint for enabling accrual on an existing wallet.

The provisioning helper now accepts an explicit interest choice, and the runner
exposes `--enable-interest-accrual`. Creation with that choice sends `true`;
the default remains `false`, so ordinary wallets and non-opted-in plans do not
start accruing interest. An existing wallet is never recreated, remapped or
reported as interest-enabled unless the provider explicitly reports
`interest_enabled: true`. An echoed creation request flag is not accepted as
proof. Missing flag and false flag both refuse before any activation writes.
The dispatch journal pins the choice and rejects changes after dispatch.

This is a local source correction, not a live activation. The historical
runner's fixed lease has expired; this change does not renew it or authorize
rerunning it. Enabling the existing wallet must preserve its account number,
10,000-kobo principal and transaction history, using a provider-confirmed update
mechanism or a provider-side change. Do not re-POST the creation endpoint or
probe additional undocumented mutation endpoints.

The owner-authorized in-place experiment sent one PATCH with
`enable_interest_accrual: true` to the existing sandbox wallet resource. The
provider returned 404. Readback still reported `interest_enabled: false`;
wallet identity, 10,000-kobo balance, ledger balance, payout destination and
funding accounts were unchanged. No wallet was recreated and no transfer was
attempted. The OPTIONS response advertised generic CORS methods, not a
wallet-specific update contract; it is not evidence that PATCH is supported.

Provider request: Please enable interest accrual on our existing sandbox
API wallet `01M3CQX27G9687EFSF1TKYMPR9` in business
`01M2381RG34HQJMHQKE7DWDACR`, preserving its balance, account number and history.
It was created with `enable_interest_accrual: false`. Please also confirm the
supported API endpoint for changing this flag on an existing wallet, if available.

References: [Create wallet](https://www.piggyvestbusiness.com/docs/api/wallet/create)
and [Retrieve wallet](https://www.piggyvestbusiness.com/docs/api/wallet/retrieve).

The fixed staging deadline remains 2026-09-29T15:59:10Z. App database system
identifier: `7685292944002592802`; receipt database: `7686901100561231906`.

## Verified on 25 September 2026

- A dedicated PiggyVest wallet was provisioned and reconciled for goal
  `430314fd-cd8b-4579-98d4-e9f345713dd6`.
- Sandbox funding of 10,000 kobo settled in provider wallet
  `01M3CQX27G9687EFSF1TKYMPR9`.
- Genuine signed event `01M3CR6MRV9766YQW6FQKJN527` arrived in durable receipt
  `f8afc061-93a0-441c-921b-6ec783d5af92`. Its transaction is
  `2232a468-1b52-4e16-abe1-fdf6f10c3a88`; missing `session_id` is accepted.
- The restricted replay worker processed the original encrypted receipt:
  one processed, zero quarantined, zero retryable, zero resolution failures.
- The goal has 100 naira saved, one completed contribution, and one projection.
  Repeating recognition with the stored original fields and restricted worker
  JWT returned `duplicate`; all three values remained unchanged.
- Authenticated requests through `https://staging.ogabassey.com` returned 200:
  wallet savings balance 100 naira, spendable wallet balance zero, and the
  active phone goal at 100 of 250,000 naira.
- The older probe wallet remains separate: two recognized credits, 20,000 kobo.

## Deployment boundary

The replay worker and staging Vercel proxy are deployed. Vercel deployment
`dpl_7qPRHtyJuMbQe2Zfw4y4rfFeQ394` adds only GET to the existing funding proxy;
webhook function bytes and other routes are unchanged.

The route installer has succeeded. Both public origins now return 401 for
unauthenticated funding GET/POST and 405 for PUT. Signed-in verification then
found a separate configuration-shape bug; the remaining artifact-only command is:

```sh
/bin/sh /private/tmp/baci-piggyvest-account-fix-20260925.sh
```

It replaces only the funding-service artifact. It proves the current Nginx
configuration is the exact output of the previously pinned route installer,
without writing or reloading Nginx. Deadline, units and credentials are preserved;
artifact rollback is retained. Until this succeeds, authenticated account lookup
still returns `MAPPING_PENDING`: do not declare that phone screen ready.

After activation, verify unauthenticated GET returns 401 and a fresh synthetic
customer GET returns the dedicated sandbox account ending 8907. Reload the
existing Metro app on port 8082; do not clear its stored session. Verify the
account screen and 100-naira progress on the phone itself.

The one-shot provisioning and funding journals live in the existing private
VPS directory. Do not delete them, resend the test deposit, adopt the older
probe credits, or reset processed receipts. Credentials are not recorded here.

## Validation

- Mobile funding/client regression suites: 6 suites, 67 tests passed, including
  customer switching under the same merchant and late-response invalidation.
- Replay suites in the existing `0d77` worktree: 14 suites, 113 tests passed.
- Local deployment/provisioning helper tests: 35 passed.
- SQL passed disposable PostgreSQL tests and a rollback-only rehearsal against
  the actual isolated schema before installation; the live duplicate check
  also passed under the restricted worker role.
- Latest Metro iOS bundle compiles. Scoped mobile Biome passes.
- Repository-wide lint/typecheck are not green: unrelated formatting errors and
  existing mobile date-display/idempotency-test type errors remain. No claim of
  a fully green monorepo or completed on-device UI test is made.

## Installer correction

The initial owner command refused after candidate extraction, before swapping
the service. The existing constructor uses the anchored Nginx guard
`if ($request_method !~ ^(POST)$)`, but the new installer had assumed
`if ($request_method != POST)`. The corrected renderer accepts the exact
installed form; it does not broaden its accepted method expressions or change
the predecessor hash. Regression tests reproduce the refusal, reject broadened
or duplicate guards, and verify Nginx preflight happens before extraction.

All 38 helper tests pass. Independent Luna review and comparison against the
original installed location constructor passed. Services and all 13 existing
route probes stayed healthy. Candidate extraction residue and the old owner
bundle are preserved; the previous command is superseded, not safe to rerun.

Corrected owner SHA-256:
`c121983f89fe3c0aebbd6211d468eef3be648f7cdd19f167bef4b84f0f81716b`.
Corrected bundle SHA-256:
`f9270c16b12a8e285ed8a7d625402fa3ee89b63deea91b5b632f9011740a45ca`.
Only `owner.py` changed in the eight-file deployment payload. Unexpected errors
remain redacted; known constant installer refusals now report their reason.

## Reload readiness correction

The regex-corrected command activated the candidate but refused its immediate
post-reload route check and restored the previous artifact. Funding and gateway
services were verified active afterward; the previous funding GET 405 / POST 401
responses were restored. Both failed candidates/backups remain preserved.

An isolated real Nginx rehearsal reproduced the race: GET returned the old 405
at 0 and 66 ms after reload, then the correct 401 at 125 ms. The exact pinned
candidate from the rollback directory separately passed GET 401 / POST 401 /
PUT 405 on an ephemeral loopback port with synthetic configuration.

The new installer checks those direct service responses before changing Nginx.
After reload it waits at most eight seconds for two consecutive complete route
checks, preserving all baseline expectations and the fixed lease. An
unauthenticated 200 fails immediately. Failures report safe method/path/status
details and still trigger rollback. The revised verifier passed the actual
Nginx rehearsal with GET samples `[405, 401, 401]` in 535 ms.

The precise regression fails against the previous shipped installer and passes
with the change. All 53 helper tests pass; Luna reviewed the integration.
CodeRabbit was invoked but skipped the untracked files, so it did not supply
a clean review. Repository-wide lint/typecheck retain the previously recorded
unrelated failures.

Latest owner SHA-256:
`c03e98ec71b06d17418818b8b2496ee7886660edd0b31d1eec340950dcc11f89`.
Readiness helper SHA-256:
`4fbf862ffbf523028e0fa1400800f7a003f34b22bef403b9288f6cc777eb33dc`.
Latest bundle SHA-256:
`cb5f4f4ac23307586a167dd993a9ea22ff5c77006bbe19100b1edfef1429bb09`.
The nine-file payload changes only the owner and adds its readiness helper;
application artifact, predecessor pin, credentials, units and lease are unchanged.
Both earlier owner commands are superseded. Owner execution and authenticated
public account lookup still remain before declaring the funding screen ready.

## Authenticated lookup correction

After the owner installed the nine-file readiness bundle successfully, public
GET/POST authentication and PUT refusal passed. Authenticated wallet and goals
reads still showed exactly 100 naira saved. Funding GET returned 202 despite the
correct mapping existing: the route passed the full provisioning configuration
to a strict three-field mapping schema. The downstream account reader also uses
a strict provider configuration schema, so its caller needed a separate projection.

GET now passes only the three mapping fields. GET and POST completion share the
six-field provider projection; neither strict schema is loosened. GET also
enforces the configured customer allowlist before mapping/provider access.
Regressions exercise the real mapping reader and strict provider schema, including
the allowlist refusal. A live read-only check using the source readers, actual
isolated mapping RPCs under `piggyvest_staging_provisioner`, and the provider's
GET endpoints returned the existing FAAS sandbox account ending 8907. No database
rows, provider wallets, deposits or balances were changed by that check.

- Focused application tests: 54 passed; owner/deployment helpers: 66 passed.
- Final VPS build and packaging passed: 11,390 files; seven candidate HTTP probes
  passed on an isolated loopback port. The temporary candidate was stopped.
- Scoped Biome passed. Root lint/typecheck retain unrelated formatting and mobile
  test failures. CodeRabbit refused the dirty tree's 196-file scope; independent
  Luna reviews supplied the actionable findings, which were fixed and tested.
- Upgrade owner SHA-256:
  `f6abce4388d604c2d1f86d93002dbc55f794468db858ce6a3cad65981e42aae7`.
- Application archive SHA-256:
  `0cc57c59d337e523c91eda2bf75631bdbda11e77817ac3744e971f6e655ea8f3`.
- Application manifest SHA-256:
  `fab70335ad07f4bc1ed8c4618d318107c11eeb9d6057c09a1082c445dcb08b37`.
- Ten-file owner bundle SHA-256:
  `849fb27743e9240a63044eebf3b679aa8c1aae70c3330f5b7fd42c89d6a04f63`.

The old bundle is preserved as `owner-bundle.before-mapping-fix.tar.gz` on the
VPS. The new Mac command passes shell syntax verification and differs from the
previous reviewed wrapper only in its pinned archive digest and success marker.
Owner activation and a fresh authenticated public GET remain pending. Metro is
running from the correct `cursor-savings-phase1` worktree on 8082; no on-device
rendering or relaunch-persistence result is claimed.
