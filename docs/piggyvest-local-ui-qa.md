# PiggyVest local UI QA — 12 September 2026

## Normal iPhone app and local database — 13 September 2026

This supersedes the isolated-preview limitation for the **native draft journey
only**. The normal wallet start-savings route now selects a local-only draft
screen when explicitly launched in local storefront mode. It uses real local
Supabase authentication, the normal Next API authentication/CSRF boundary and
durable PostgreSQL records, not the earlier QA panel or an injected session.

Implemented and tested: exact device/variant selection, server-owned catalogue
price snapshots, persisted request identity, explicit disclosure consent,
reopening receipts, cross-customer denial and explicit replacement of stale
drafts. Unknown outcomes retry the retained request, rather than creating a new
one automatically. These records are **drafts**, not activated savings plans.

### Evidence and limits

- An isolated local Supabase stack loaded verified historical/current schema
  sources and the two append-only customer-draft migrations. Only synthetic
  merchant/customer/catalogue records were seeded. Scheduled jobs are disabled;
  database, Auth, REST and local email services use an internal Docker network.
- Real synthetic email OTP issuance and verification passed through the LAN
  relay. The test email is `customer@savings.local.test`; email stays in local
  Mailpit. No production account or external email is used.
- Actual authenticated HTTP checks passed for variant validation, draft
  creation/retry, conflicting request rejection, stale terms rejection, consent
  and receipt reload. An initial repeat of the HTTP script reused a valid
  request ID for the invalid-variant test; separating that invalid fixture made
  the repeatable test pass without weakening server validation.
- Parent native draft checks: 27 tests across five suites passed. Delegate
  backend checks: 73 tests, 47 SQL rollback assertions and separate-connection
  concurrency cases passed. Launcher/config: 55 Node tests; local runtime/auth:
  111 focused Jest tests passed. Scopes overlap and must not be totalled.
- Parent root lint and typecheck passed with existing lint warnings. Normal iOS
  Metro bundle compiled successfully (HTTP 200). This is not a native build,
  CodeRabbit/full-suite approval or physical-device acceptance.
- Review caught the two new migrations missing from the exact source registry.
  Failing-first checks reproduced this; their unchanged SQL hashes are now
  registered, and 101 registry/manifest tests plus root lint/typecheck pass.
  Neither applied migration was edited.
- The connected iPhone became unavailable immediately before the normal-app
  launch. Device UI sign-in, wallet navigation and draft confirmation remain
  unverified; do not describe the phone journey as passed yet.

### Local phone handoff

The owned temporary runtime is `/private/tmp/baci-savings-local.LfiKp5`.
`start-phone.mjs` starts the normal local configuration and two capability-gated
LAN relays; it does not load repository env files. API and Supabase relay origins
are `http://192.168.100.70:4193` and `http://192.168.100.70:4192`. Metro is port
8082. The launcher expires after one hour; restart it and fully reload the app
if it expires. Send SIGTERM only to that launcher's exact owned process to stop
Metro and both relays; database and Next server lifetimes are separate.

Reconnect/unlock the installed iOS development build and open the Metro session.
Sign in with the synthetic email and its fresh local Mailpit OTP, then open
Wallet → Start saving, select the test phone and its exact variant, create a
draft, review/confirm the test disclosure, and reopen the saved draft. No real
bank account, contribution, withdrawal, refund or checkout is enabled.

Local storage is namespaced; existing production storage is not cleared.
The JS transport pins exact local origins and Auth issuer, while actual local
Supabase verifies the token. Foreign API keys/cookies and nonlocal fetches are
denied. Monitoring, ads, push and social OAuth initialization are disabled in
local mode. These are JS/config protections, not proof that an existing native
binary has no embedded vendor configuration or an OS-wide network firewall.

### Still outside this result

The web frontend does not yet call these new draft endpoints. Promotion of an
accepted draft into the canonical savings/provider lifecycle is not implemented
by this slice. Funding, interest, cancellation/refund and purchase require their
remaining technical contracts and connected validation; existing business
approval is not being reopened. No cloud deployment/migration, provider API
execution, public webhook readiness or end-to-end sandbox success is established
by these local results. External changes still require owner approval.

## Composed screen follow-up

The loopback preview now renders the actual `SavingsScreen`, rather than three
independent panels. The actual web wallet section has an optional staging branch;
its server boundary validates the entire source before serialization, forwards
only validated data or a clean unavailable DTO, and never falls back to the
legacy wallet when staging input is present. No page supplies this input yet.

Parent browser checks on the updated preview confirmed unchecked consent,
disabled pending submission, recorded synthetic consent with funding still
blocked, separately selected synthetic eligibility revealing pending funding and
progress, exact-variant change clearing consent and eligibility, and sign-out
removing draft/funding/progress. Signing back in starts with unchecked consent.
The eligibility selector is a fixture control, not a real permission mechanism.

Parent reran six composed-screen interaction tests, four fixture/source tests and
three loopback configuration/server tests successfully. Shared portable consent
contracts pass 32 tests; the web compatibility/panel run passes 31. Provider
library and policy-schema regressions pass 686 tests with 19 opt-in database
tests skipped. These scopes overlap; do not add them into a unique test total.

No real staging activation, provider API call, native installation or device UI
test is established by this follow-up. Customer purchase remains blocked.

The native start-savings entry now selects its staging child before mounting any
legacy controller. Its exact draft review, explicit consent, pending/error states
and separately supplied funding eligibility have component coverage. Independent
review found and regression-tested two additional issues: an obsolete consent
callback settling before effect cleanup, and an array readiness value coercing
into a valid key. Pending-state identity and strict string validation fix them.

Final parent verification for this batch:

- Web screen/schema/server-boundary tests: 53 passed across three suites,
  including rejection of extra/private fields before server-to-client transfer.
- Native savings folder plus variant-recovery modal: 165 passed across 25 suites.
- Root `pnpm turbo lint`: four tasks passed, existing warnings remain.
- Root `pnpm turbo typecheck`: six tasks passed.
- `git diff --check`: passed. No protected-file edits in this batch.

An early check against in-progress native files failed formatting and a Jest
lifecycle callback return type; these were fixed before the final checks above.
No full-monorepo test-suite, CodeRabbit, deployed staging or provider end-to-end
green status is claimed. Native presentation tests are not device acceptance.

## Browser evidence

Parent tested the isolated preview at `http://127.0.0.1:4179/` in the Codex
in-app browser. It renders the actual PolicyPanel, FundingPanel and
CustomerSavingsStatus components with synthetic in-memory adapters. It is not
the live storefront, a provider sandbox session or an authenticated customer test.

| Scenario | Observed result |
| --- | --- |
| Initial terms | Consent unchecked; acceptance button disabled |
| Explicit consent | Button enables, becomes disabled while pending, then shows recorded draft consent |
| Exact variant switch | Green/128 GB/used changes to Blue/256 GB/new; new draft consent is unchecked |
| Funding pending | Pending confirmation message, no account details |
| Synthetic funding ready | Fictional bank/name and `NOT-A-BANK-ACCOUNT` placeholder displayed |
| Session removed | Draft and funding unavailable; account details, balances and consent controls disappear |
| Consent failure | No recorded-consent claim; generic failure and retry action displayed |
| Savings progress | Synthetic principal and pending interest displayed separately; purchase remains unavailable |

The desktop screenshot showed three readable panels without overlapping text.
No responsive/mobile browser viewport or native device UI acceptance is claimed.
Fixture-control changes deliberately remount the preview; dedicated automated
panel tests, not this fixture, establish stale-promise protection.

## Safety and limits

The preview binds only loopback. Env/config discovery and public directory are
disabled; CSP restricts browser connections to the local preview. No real account
number, provider response, credential, customer record or money operation is used.
Consent is a simulation, not acceptance of business terms. Reload resets it.

Launch: `node tools/test/piggyvest-web-preview/server.mjs`.
Fixture tests: `node --experimental-strip-types --test tools/test/piggyvest-web-preview/fixtures.test.ts`.

The preview remains available for local inspection. Production/staging deployment,
native device installation, actual provider events, payments, refunds and real
customer authentication were not performed during this browser check.

## Regression found during review

Exact products without variants were rejected by the customer-status schema and
displayed an empty Variant row. Two failing regressions reproduced this. The
schema/type now accept explicit null, and the UI omits that row. The combined
schema, component and server-projection run passes 26 tests across three suites.
An additional failing-first regression ensures null display metadata is rejected
when the trusted policy names an actual variant; null does not stand for an
unresolved choice.

## Mobile regression review

Parent ran the mobile savings folder plus the variant-recovery modal: 23 suites,
143 tests passed. The tests mock network/native effects; no simulator, emulator,
physical device, installation or real authorization was exercised.

Fixed and regression-tested:

- Mounted route changes and matching catalog refreshes reconcile exact variant
  identity/price; removed choices cannot remain silently selected.
- A delayed product switch preserves auto-target provenance, replacing the old
  automatic amount when the next product loads while retaining custom targets.
- Late goal-creation success/errors cannot overwrite another form context.
- Only a matching, confirmed-success contribution idempotency key is retired;
  indeterminate requests retain their keys and newer keys are not cleared.
- Late card-authorization navigation/errors are suppressed after context changes
  or unmount. This does not cancel any provider-side authorization.
- Saved-card state clears across merchant changes.
- Variant-recovery errors from a dismissed/replaced modal no longer alert over
  the current goal; current-session error and successful retry remain tested.

Independent follow-up source review found the three additional target, key and
authorization findings resolved. Parent separately verified the test results.
Jest still reports its existing forced-exit advisory; no full-monorepo green claim.

## Additional local checks

- Web provider/schema/components: 90 suites, 1,099 tests passed; 19 opt-in database
  tests skipped in that normal run. This scope excludes migration-registry tests.
- Preview: two actual-component interaction tests, two fixture tests and three
  server/configuration tests passed. Local HTTP tests verify file-access denial.
- Native prerequisites were inspected read-only: SDK/emulator binaries and a QA
  AVD exist, but no healthy running device or isolated installed build is proven.
  Use the storefront launcher, not the admin launcher, for later approved native
  QA. A test build and isolated configuration are needed before device testing;
  mirroring a production app is not an acceptable substitute.

The first final typecheck caught a test lifecycle callback returning a mock rather
than void. That test-only callback was corrected; its four idempotency tests and
the subsequent root lint/typecheck passed. Existing lint warnings are not hidden.

## Connected duration follow-up — 12 September 2026

Loopback browser checks show one month for the green synthetic variant and three
months for the blue variant. Switching variants resets consent; acceptance alone
leaves funding blocked. This is not a deployed or authenticated storefront.
Preview automated checks pass six component, four fixture/source and three
server/configuration tests. Cancellation review has component and connected
real-local-database coverage, not browser/device acceptance. See
`docs/piggyvest-connected-implementation.md` for current evidence and release gates.
