# Manual Oxygen eligibility probe

## Durable local application checkpoint (10 October 2026)

This supersedes the earlier memory-only restart limitation for new runs. The CLI
automatically saves and restores the application reference, original phone,
new-customer validation token, customer branch, creation lock and retry state in
`~/.local/state/baci-oxygen/manual-test/<environment>.json`. The directory is
owner-only (0700) and files owner-readable/writable (0600), outside the repository.
The checkpoint contains sensitive customer validation state; it is not encrypted
and must not be shared. Partner API keys, partner login tokens, OTPs, BVN/NIN,
bank details, consent and full customer payloads are excluded. Partner reference
binding is a SHA-256 digest; another partner or corrupt checkpoint stops startup.
Partner credentials must still be supplied privately on each launch.

Writes use a private temporary file, file sync, atomic rename and directory sync.
Creation is locked and saved before the provider call; successful creation is
saved before returning to the browser. Storage failures stop further calls.
An interrupted creation remains locked after restart and requires reconciliation;
the tool never automatically recreates or retries it. OTP entry remains manual.
Checkpoint restoration does not assert that Oxygen's customer token is still valid.

Previously lost in-memory references cannot be recovered by this fix. No fresh
application is created automatically. Local tests first reproduced missing
restart restoration, absent pre-call persistence and an unlocked restored UI.

Validation: 43/43 manual-tool tests pass; web lint/typecheck and whitespace checks
pass. Final CodeRabbit review included both new checkpoint files and raised one
minor issue on the pre-existing `draft.js` identity autosave, with no checkpoint
findings. Its localStorage expiry is enforced on next load, so unopened drafts
can remain on disk longer than 24 hours. Removing BVN/NIN from browser autosave
was deferred to preserve the user's explicitly requested field restoration;
this concern is acknowledged rather than reported as a clean review.
The repaired staging runner was restarted with privately supplied keys; login
and automatic account-name enquiry succeeded. Existing form fields restored.
No new customer creation, OTP submission or financial action was made for this fix.

## Staging access verified (9 October 2026)

The authenticated **Phonepreneur Staging Test** portal is active and displayed
zero payouts and sub-stores. Its staging API host was observed from the portal's
requests, then verified using its partner credentials:

- `POST https://staging-api.theoxygen.com/services/partners/v1/partner/login`:
  HTTP 200, token present, `expires_in: 300`.
- `GET https://staging-api.theoxygen.com/services/partners/v1/eligibility/banks`:
  HTTP 200, 23 banks.
- The local form independently returned `authenticated` and `banks_loaded` with
  those HTTP statuses. No customer creation or identity validation has been
  submitted in this staging run; participant input and consent are still needed.

The runner now accepts `--staging` and rejects environment/host mismatches.
Select exactly one of `--staging`, `--dev`, or `--production`. Credentials remain
in process memory; their values and tokens were neither printed nor saved.
This does not establish staging OTP fixtures, reset behavior, or a completed
selfie/eligibility journey.

From `apps/web`, with credentials supplied privately to the process:

```sh
node --conditions=react-server --import tsx tools/oxygen-manual-test/cli.ts --staging
```

Regression evidence: staging support failed first at the unsupported pairing
guard; after the change, the manual-tool suite passes 38 tests. The same test
rejects staging paired with the production host. Customer terms and OTP entry
remain explicit user steps.

### Synthetic customer probe (9 October 2026)

After the user requested fake details and separately confirmed acceptance of
customer terms for this staging test, the form used clearly synthetic names,
an `example.com` email, zero-filled identity/account numbers, and a zero-filled
phone subscriber number. The automatic account-name enquiry returned HTTP 200
with `Demo Account`. Customer creation returned HTTP 400 with the diagnostic
`Invalid  phone number  supplied.`; `errors` and `response_code` were null and
no loan-request reference was returned. The enquiry is demonstrably simulated
for this input, but arbitrary fake customer details are not universally accepted.
No OTP, selfie, KYC, or eligibility step was reached. The rejected request and
form draft remain available; no automatic retry was made.

The user then supplied their phone number for one staging retry. Authentication
and the automatic bank lookup succeeded again. After explicitly preparing the
retry, creation returned HTTP 200 with a loan-request reference and customer
validation token, classified as `new`. The original synthetic BVN, NIN, bank
account and other customer fields were retained. This proves those values passed
creation for this staging request; it does not prove downstream identity checks
will accept them. OTP validation is pending the user's received code. Reference
and token values remain private in the running server.

User-authorized 7 October 2026: user selects production and performs the test
with their own details. This is a local operator test screen, separate from
checkout/customer availability. The existing payment initiation remains disabled.

## Start

From `/Users/mac/Baci-worktrees/oxygen-integration`:

```sh
pnpm --filter @baci/web exec tsx tools/oxygen-manual-test/cli.ts --production --credentials
```

Stop the assistant-started preview listener before launching the credential-enabled
runner (or ask the assistant to restart it for credential entry).
Enter partner reference and secret at the hidden terminal prompts. Do not put
keys in arguments, source files, screenshots, browser forms or committed env files.
Alternatively existing process environment OXYGEN_TEST_REFERENCE and
OXYGEN_TEST_SECRET may be supplied from an approved secret store.
No `.env` files are read or edited by this runner.

Open http://127.0.0.1:3417 . The listener binds loopback only. It checks exact
host/origin and a per-run CSRF capability. Both credentials and provider references
are kept in server memory; tokens, identity values and raw provider errors are not
returned in the result log. The hosted selfie URL is shown only as a user-operated
link, never copied into the result preview or opened automatically.

Authenticate, enter your details and confirm applicable customer terms, then
create one loan request. The recognized creation message indicates existing/new
customer branch; unknown messages stay unknown. Choose the corresponding OTP
button. New-user tokens returned directly at top level are retained server-side;
if missing, obtain the token from Oxygen and enter it manually. Do not invent one.
Request the selfie link, complete verification yourself, then manually inspect KYC
and eligibility. No automatic polling or retries; a token expiry needs explicit
partner reauthentication. Reported eligible amount uses unconfirmed provider units.

Only login/create/existing-validation/new-validation/selfie/KYC/eligibility paths
are supported. No booking/approval/activation/cancellation/payout routes exist.

## Limits

- Production is real: customer records, notifications and credit checks may occur.
  This is not a sandbox or a full loan-journey acceptance test.
- A create call locks further creation in this run, including ambiguous failures.
  Restarting loses the reference; it is not a recovery mechanism. Reconcile any
  lost response with Oxygen before starting another run.
- Schema checks mirror fields in examples; no complete provider field matrix is
  claimed. No bank statements or address documents collected by this screen.
- This memory-only single-participant tool must never be deployed or used as
  customer checkout. Shared/durable attempt orchestration still needs provider
  idempotency and merchant mapping contracts.
- Result display includes safe codes, HTTP status, field names/types and recognized
  eligibility only. Unknown payloads do not become approval/decline decisions.

## Validation

Tests in tools/oxygen-manual-test use synthetic fixtures and mocked provider
fetches. HTTP tests cover host/origin/CSRF restrictions and unsupported financial
operations. Browser-control tests cover no automatic calls, auth gating and lost
local response locking. Prior code remains covered by the Oxygen suite.

Final evidence: 609/609 affected Oxygen/probe tests across 17 files; affected web
lint and typecheck pass; whitespace clean. First CodeRabbit run raised one minor
asset-path issue. Regression reproduced ENOENT from another working directory;
module-relative asset resolution fixed it, with tool-local ESM package scope.
Final uncommitted CodeRabbit review: 0 issues across 58 files, including tool runtime
and tests. No runtime changes after that review. Current screen opened and browser
script served successfully; credentials still missing, so live calls remain disabled.

### Bank selector (7 October 2026)

After partner authentication, click **Load banks from Oxygen**, then choose a bank. This performs authenticated `GET /v1/eligibility/banks` and uses the documented `Status`, `Result`, `Name`, and `SortCode` response fields. Bank name and code are read-only and filled together. No bank request runs automatically, and no guessed/static codes are used. Unknown/malformed bank responses leave selection unavailable.

Validation: three new regression tests failed before implementation; 612 affected tests pass and web lint/typecheck pass. Final CodeRabbit review completed with 0 issues. After the user signed in and explicitly authorized clipboard transfer, reference and secret were copied directly into the local process environment, without printing or saving their values; the system clipboard was cleared afterward. Production login returned HTTP 200 and the authenticated bank GET returned HTTP 200 with 44 banks. The form was refreshed to load the controls, with typed non-bank input values restored through browser memory (not files/logs); consent boxes remain for the user to check. No customer creation, OTP, KYC or eligibility request was submitted. Recheck employment selection and customer consent before creating an application.

### Automatic account-name enquiry and expired-login feedback (7 October 2026)

Account name is read-only and is resolved automatically after partner authentication when bank code, account number and phone number are complete. After a 500 ms typing pause, the local server validates these inputs and calls documented `POST /v1/partner-loans/name-enquiry` with `type: EXTERNAL`. It only accepts a successful response with `errorCode: 0` and a nonempty account name. Changing any lookup input clears the name; stale responses cannot fill the changed account, and a changed lookup waits for any in-flight action. Names are displayed in the form but excluded from the results panel and not persisted or logged. Unknown/failing lookups do not retry automatically.

The user's unresponsive Create click was inspected without reading input values: safe result was `login_required`, with Create incorrectly locked. This server response occurs before the provider create call. The UI now clears the client lock for that preflight response, explains the expired login beside Create, and permits an explicit new attempt after authentication. Indeterminate/provider-reached creates retain their lock. Five regression tests failed before their fixes; 617 affected tests pass, web lint/typecheck pass, and diff checks are clean. Final CodeRabbit review completed with 0 issues. The updated runner was restarted with the credentials held in the previous task-owned process environment, passed in memory without output or files; portal sign-in was unnecessary. Production authentication succeeded and 44 banks reloaded. The browser masked phone, email, BVN, NIN and account-number values during restoration; those placeholders were cleared, leaving these five fields for the user to re-enter. The bank and employment selection were restored; consent checkboxes remain unchecked. Account enquiry is connected but not live-verified because the required fields are now empty. No Create retry has been made by the assistant.

### Tab-scoped form autosave (7 October 2026)

At the user's explicit request, input values (including BVN, NIN and account number) are saved to browser `sessionStorage` in the local test tab, with a sliding 30-minute restore expiry. Drafts are separated by environment. API keys, OTPs, validation tokens, resolved account names and consent checkboxes are excluded. Draft restoration never makes a provider request; authenticate and load banks to reverify the account. A **Forget saved form** button clears the draft and visible inputs. Successful creation clears saved inputs; a separate tab-scoped creation lock survives refresh and is not removed by forgetting inputs or draft expiry. The local server's creation lock remains authoritative.

Validation: refresh restoration and expiry tests, plus the existing manual tool suite; web lint/typecheck pass. This update is served by the current runner's dynamic client-script route, so no server restart is needed. The currently filled tab has not been refreshed; its loaded older script does not yet autosave. The new behavior activates on the next page load. No provider calls or customer submissions were made for this slice.

Final autosave validation: 619 affected tests pass; web lint/typecheck and diff checks pass. CodeRabbit completed with 0 issues. A separate blank browser tab with a synthetic first name verified actual save → reload → restore → forget behavior; no authentication/provider action was invoked. The original filled user tab was left untouched.

### Manual rejected-request recovery (7 October 2026)

This supersedes the earlier absolute one-create-per-run constraint. A JSON HTTP 400 create response with a message and no loan-request reference makes a local **Enable one manual retry** operation available. It requires the user to acknowledge duplicate risk. It only releases the lock; it does not call Oxygen or submit/accept another application. A 400 does not prove that no provider-side record exists. Timeout, lost response, malformed response, success/reference or other status cannot be unlocked through this operation. No automated retries are performed.

The historical rejection was restored explicitly on runner restart with `--resume-rejected-create`, retaining the locked state without recreating a loan. This is an operator recovery flag, not a provider reconciliation claim. Existing keys were reused in memory without printing/saving them. Before refresh, a change event on the employment selector saved the actual current DOM form directly to tab storage, avoiding redacted-value copying. Refresh then restored all five private fields, bank selection and employment; account name was resolved again. Consent ticks remain unchecked. Redacted provider error wording is now active in the running server for future errors. Original 400 wording is still unrecoverable.

624 affected tests and web lint/typecheck pass. The first CodeRabbit attempt failed with WebSocket closed; a retry is required for the review gate. Authentication initially returned a network error after restart; an explicit non-financial retry succeeded, followed by 44 banks and successful account-name resolution. No Create/OTP/loan/terms action was performed by the assistant.

The CodeRabbit retry completed with 0 issues. Final screen-text changes passed 15 browser/HTTP tests. The updated runner and recovery controls are visible; form values restored without reading or copying their private contents. The assistant did not tick retry acknowledgement, enable the retry, accept terms, or submit Create.


### Resumed request and OTP resend (7 October 2026)

The active new-customer request was preserved privately in memory across the local runner update. No identifiers, tokens, keys or original form values were printed or written to files. The temporary task-owned loopback debugger was closed after capture. A validated resume contract restores the existing reference and customer branch, keeps Create locked, and exposes only request-presence and branch to the UI.

The assistant refreshed partner authentication successfully and invoked one user-authorized POST to `/v1/loan-request/retrigger/otp/new/user` using the preserved request and partner references. Oxygen returned HTTP 200 with shape `{ "Message": "string" }`, rather than the documented lowercase `message`; the UI correctly reports `unknown_resend_response`. Exact message text was not retained, so accepted resend or SMS delivery is not claimed. No automatic retry, new application, OTP validation, booking or activation was performed. The user should use the latest SMS if received and validate the new-customer request manually.

Validation: 626 affected tests pass, web lint/typecheck pass, diff check clean, and CodeRabbit completed with zero findings before runner update.

### Recovery screen correction (2026-10-08)

A created request now hides the creation form and rejected-create retry controls. The recovery panel continues the same request; no customer-branch switch or new application is inferred from the selfie error. KYC responses expose only recognized DONE, NOT_DONE, PROCESSING or UNKNOWN values. The observed `BVN already exists` response is classified as requiring provider recovery clarification. Documented validation success and the observed uppercase resend message key are recognized.

Regression evidence: five failing assertions before implementation; 630 affected tests pass after the fix. Web lint and typecheck pass. Provider-side selfie recovery remains unresolved.

Local screen updated on port 3418 with the active request preserved privately in memory. Partner authentication returned 200, then a read of that same request returned KYC 200: address NOT_DONE, selfie NOT_DONE; both are now visible. No new creation or OTP validation was submitted. CodeRabbit completed with zero findings across 64 files.

### Owner-requested form retention (2026-10-08)

The draft now remains in browser localStorage for 24 hours and is retained after successful creation. Existing tab-scoped drafts migrate on reload. OTPs, validation tokens and consent are excluded. Create locking remains separate and prevents the saved draft from submitting automatically. Forget saved form removes both old and current draft stores. Regression test failed before the fix; all 37 manual-tool tests and web lint/typecheck pass. Filled details were restored in the port 3419 browser after reload; no identity values were written to repository files or logs. CodeRabbit is pending.

### Explicitly separate local checkout attempts

A normal checkout intentionally resumes a matching unpaid order. Removing
`oxygenOrderId` from its URL does **not** create a new provider request.

For an owner-authorized separate staging test, the actual checkout accepts
`oxygenTestAttempt=<fresh UUID>` only when `NODE_ENV=development` and
`NEXT_PUBLIC_OXYGEN_LOCAL_CHECKOUT=true`. This skips matching-order reuse for
Oxygen and scopes order idempotency to that explicit attempt. Repeated clicks
with the same attempt still reuse its order creation key. Neither the old
workflow nor its reconciliation lock is reset or cancelled.

An optional `oxygenDraftSource=<owned workflow UUID>` restores an unexpired
saved draft into an empty new application. Both workflows must be visible to
the normal authenticated caller under RLS and belong to the same customer and
merchant in staging. Source data is read without modification; the new draft
is encrypted under its own workflow when saved. Existing target drafts take
precedence. Consent, OTPs, bank-name verification and provider verification
facts are not copied: bank resolution runs again and consent requires a fresh
customer action. BVN/NIN values are not put in browser storage or diagnostic output.

This is local test preparation, not production expiry recovery or permission
to retry an indeterminate booking. Activation and settlement remain disabled.
