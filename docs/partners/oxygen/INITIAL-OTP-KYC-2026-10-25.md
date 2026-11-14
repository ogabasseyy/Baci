# Initial OTP and NIN verification observation — 25 October 2026

Current order: 690a9d2e-33b7-4106-8c68-b9019f814dce.
Workflow: 52ab6696-762b-4e9f-8f99-a9d926a29b2c.
No older workflow was changed.

Saved command timeline (Africa/Lagos):
- Application creation succeeded at 21:14:12.
- Initial customer OTP validation succeeded at 21:14:29.
- KYC status refresh succeeded at 21:14:33.
- NIN validation became indeterminate at 21:14:38 after an HTTP 500,
  provider message Internal Server Error; recorded provider duration 2247ms.

The workflow is version 4, reconciliation_required, pending validate_nin.
Saved KYC: phone DONE; BVN, NIN, bank, selfie and address NOT_DONE.
No selfie URL or booking reference was saved. Guided verification checks NIN
before preparing the selfie link, so the camera handoff was not reached.

A single read-only provider KYC-status request at 21:18:09 returned HTTP 200 and
the same statuses. It did not mutate the saved workflow, clear the pending
command, resubmit NIN or trigger a selfie/booking/OTP/financial operation.
The command fingerprint was unchanged before/after. Encrypted raw capture and
safe report are in runtime/private/kyc-status-after-otp-20261025*. These are
outside Git; do not print the key or decrypted identifying fields.

UI changes:
- Active pre-plan identity work says Verifying your identity rather than
  claiming payment options are being checked.
- Removed the repeated visible waiting sentence (kept an accessible status).
- An uncertain NIN operation says Your identity check needs confirmation,
  explains that the code was accepted and asks the customer not to resubmit.
- Other application/booking waiting messages and saved-status checks remain.

Regression tests failed before the UI changes; all 34 affected tests pass.
No recovery/retry authorization is inferred from this investigation. Activation
and settlement remain disabled. Reconcile the current NIN operation using
provider-confirmed evidence before any further mutation.

## Capture and sequencing clarification

The observed HTTP failure is not evidence of invalid NIN, and the initial OTP
success is not evidence of passed BVN. Saved and subsequent provider KYC states
show only phone DONE. The app sends BVN during application creation, checks KYC
after OTP, then attempts NIN when NIN is NOT_DONE. It currently does not wait for
BVN DONE before that NIN command. Confirm this ordering with Oxygen before
inferring whether an additional prerequisite is missing. No retry was made.

Captured diagnostic for the original attempt: operation nin, HTTP 500,
providerMessage Internal Server Error, providerCode null, providerRequestId
null, parsed capture, durationMs 2247. This is NOT the original full response
body. The legacy response-evidence projection omitted verification states and
non-2xx error detail fields, so discarded details cannot be reconstructed.

Capture improvements: provider errors now pass already-redacted diagnostic
message/code plus bounded redacted errors/details messages into encrypted
response evidence. Successful KYC responses retain only recognized status enums
for known fields. No identity values, OTPs, passwords, tokens or arbitrary raw
objects are copied. Diagnostic DB shape remains unchanged; no migration needed.

UI heading now names NIN confirmation, preserves OTP acceptance and does not
claim NIN is invalid. 654 affected library/verification UI tests pass; web
TypeScript and affected Biome checks pass. Current workflow/pending command and
all financial-action restrictions were preserved. No provider operation was
made during this capture fix.

## Owner-authorized initial OTP resend probe — 21:36 Lagos

User explicitly requested testing whether resending the initial OTP could recover
the post-OTP outage. One request was sent to the saved NEW-customer retrigger
endpoint for this exact application reference. No alternate customer branch was
tried. Oxygen replied HTTP 400, exact sanitized message: Loan request has been
validated. The call took 385ms. No new OTP was sent and no OTP was submitted.

All indeterminate command records had the same fingerprint before/after. The
NIN hold was not cleared, no NIN request replayed, no application or booking
created, and activation/settlement remained disabled. An exclusive local lock
prevents accidental replay of this diagnostic probe after interruption. Full
response is encrypted in runtime/private/initial-otp-resend-after-nin-500-*.enc.json;
safe report lives beside it. Never delete that lock to repeat a probe silently.

UX conclusion for THIS failure: phone validation stays complete; show the
NIN/identity confirmation error rather than return to OTP entry or auto-resend.
An outage during OTP validation itself is a separate state: reconcile its result
before claiming success or deciding whether a code resend is appropriate. This
probe does not establish replay safety for NIN verification.

## Selfie-before-NIN correction and same-application handoff — 21:44 Lagos

Owner supplied Oxygen's clarification that selfie must precede NIN, then
explicitly authorized fixing the sequence and opening selfie for the current
application without creating another application or retrying NIN. Earlier
assumptions that NIN should run first were incorrect and are superseded here.

UI requests the selfie link first and waits for selfie_status DONE before it
can request NIN. Server policy blocks validate_nin before saved selfie DONE;
the executor additionally checks fresh KYC and skips NIN if selfie is no longer
DONE. A changed status cannot cause a stale-state NIN request. Tests demonstrate
the former order fails these conditions and the corrected order passes.

For the currently held application, made one explicitly authorized selfie-link
request bound to its existing applicationReference. HTTP 200, validated hosted
origin staging.d1l1k5yxed9cvn.amplifyapp.com. Opened the provider's Face
Verification page, showing ENABLE WEBCAM, for the owner to complete. No camera
permission or biometric capture was performed by the agent. No new application,
OTP, NIN retry, booking, approval, activation or settlement was requested.
All indeterminate command records had unchanged fingerprints before/after.
The original NIN command and reconciliation hold are preserved. This was a
scoped owner-authorized prerequisite handoff, not a blanket reconciliation
bypass; current local workflow state was not manually reset or overwritten.

Raw response encrypted under runtime/private/selfie-link-*.enc.json; the hosted
URL is retained in a 0600 private handoff file outside Git. Do not publish the
URL/token. One-use request lock prevents replay after interruption. Browser
screenshot: /tmp/oxygen-current-selfie-verification.png.

Validation: 654 library/guided-verification/provider-flow tests pass, plus web
typecheck and affected Biome checks. Activation/settlement contracts unchanged.

## Same-modal selfie on localhost:3000

Owner requested running on the provider-permitted localhost:3000 origin and opening the same application's selfie in the existing dialog. Portable launcher now accepts `--port 3000` (3440 remains the default); bridge accepts those exact loopback origins. No credential configuration was edited. Local storefront CSP permits only the exact Oxygen staging selfie host, and local checkout delegates camera only to that host. Production policy and microphone delegation remain unchanged.

Added an in-dialog hosted-selfie surface with Back navigation. Application fields stay mounted and background prerequisite checks pause while the selfie surface is open. Loading/closing the frame never marks verification complete. The existing reconciliation notice exposes the saved selfie handoff while retaining the NIN hold.

The already-issued provider URL was bound to this exact isolated staging workflow's private provider state using a scoped operator transaction; no provider call or workflow/command transition occurred. Exact current order and workflow bindings, validated state, no booking, and the existing indeterminate NIN command were asserted. All indeterminate command fingerprints were unchanged. Private binding receipt is `runtime/private/existing-selfie-handoff-binding-report.json` outside the checkout. Do not expose its signed URL.

Verified actual Oxygen Face Verification content and Enable Webcam in the same modal on port 3000. Camera was not enabled by the agent. No NIN retry, application creation, booking, approval, activation or settlement. Browser camera capture/permission remains for the user.

Validation: 681 tests in 44 files passed, web TypeScript passed, affected Biome passed. No deployment or latest CodeRabbit shipping review.

## Automatic selfie handoff and provider-confirmed return

After OTP is provider-confirmed and a trusted selfie URL is saved, checkout now opens that selfie inside the existing dialog automatically, once per URL per mounted application. Restoring this same OTP-verified application also resumes that surface. Back preserves the application without immediately reopening the same URL. No new OTP/application/selfie-link request was used for this test.

Added an authenticated, ownership-checked, staging-only selfie-status read. The customer client establishes RLS access before the normal bound worker reads the same workflow. Only the existing application's KYC-status operation is called; the response exposes `confirmed` and `checkedAt`, never identity values or the hosted URL. Reads do not enqueue, finish, reconcile or modify commands. Responses are not cached; reads are rate limited, serial, bounded to 15 per session with a 15-second interval, and aborted on close. A paused status-only retry is available after the bound. Iframe load, navigation, closure, and window messages cannot confirm success.

The dialog returns to the saved application only after provider `selfie_status: DONE`. Unblocked applications then refresh saved KYC. The current indeterminate NIN workflow only refreshes its saved application and retains its hold. Automatic NIN dispatch is paused, including after successful selfie; the UI explicitly says the next identity check is paused in staging. A safe journey completion event records the selfie milestone without URL or identity data.

Live test: reopened the existing checkout and observed automatic same-modal Face Verification without clicking Continue. Authenticated selfie-status reads returned HTTP 200. Read-only DB verification retained workflow version 4, `reconciliation_required`, original NIN command indeterminate, and no booking. No webcam capture was performed by the agent; actual selfie success is not claimed. Mocked UI integration verified the same dialog stays open until a provider-confirmed response and then restores the application with no NIN submission.

Validation: 688 affected tests across 48 files passed, plus one complete mocked selfie-dialog journey test; web TypeScript and affected Biome passed. A wider component run also found three older approval/payment expectation failures: OxygenOfferCompletion's `Send approval OTP`, OxygenSavedPlans' `Pay upfront amount`, and its generic indeterminate-approval heading. Those unrelated assertions remain unresolved; the broader suite is not claimed green. No commit, deployment or latest shipping review.

## Laptop-to-phone selfie fallback (temporary staging bridge)

Owner authorized a temporary HTTPS tunnel limited to the selfie handoff page and token exchange. Added **Try on your phone** in the existing selfie header. It is always available: the current Oxygen bundle at `/assets/index-CqJaDRBm.js` sends `FACE_RECOGNITION_SUCCESS` only when the customer presses Continue in its success modal; its error modal retries internally and no parent failure event was found. Camera permission failure stays inside that cross-origin page. We therefore do not claim to detect individual provider camera/verification errors. An exact-origin, exact-iframe success hint now accelerates a KYC read, but cannot directly complete the application.

The existing signed URL was 4,786 characters, too long for a standard byte-mode QR. Added a temporary staging bridge outside the source checkout at `runtime/selfie-handoff.py`: loopback 3456 issues locally-generated PNG QRs; only loopback 3455 is tunneled. Public allowlist: GET `/selfie`, POST `/exchange`. Admin, general storefront APIs, and `/issue` were verified 404 over HTTPS. The bridge serves no app proxy, analytics, external QR generator, or persisted identity store. The bearer token is random, held as a hash in process memory, single-use, and capped at five minutes/provider-link expiry. Its URL fragment is cleared before exchange and never reaches access logs. The provider URL is returned only over the authorized HTTPS token exchange, then the phone navigates directly to Oxygen.

The authenticated local-development-only issue endpoint checks caller ownership and normal worker/application binding. It reuses a live saved URL or renews only the same application's selfie URL if expired. It does not write workflow/command state or call NIN/OTP/booking/approval/activation/settlement. Current phone QR preparation returned HTTP 200. Laptop KYC checks continue independently of the phone's top-level browser page.

This is an explicit temporary local testing bridge, not production delivery. Production requires an approved public handoff deployment and durable scoped TTL storage. The tunnel/processes must stay running for this test; new bridge processes invalidate in-memory codes. Runtime dependency `qrcode[pil]` was installed only in the portable Python venv, adding no web bundle dependency. Private tunnel origin/log files are under `runtime/private`; never publish provider URLs or QR bearer fragments.

Validation: 645 affected web tests passed; five Python bridge tests passed (single use, expiry, trust boundary, lifetime cap, malformed token). TypeScript/Biome passed. Public entry smoke tests verified HTTPS landing and blocked routes. A separate exact-origin/source message regression test covers spoofed messages and requires provider confirmation. QR is displayed in checkout for the user; actual phone capture remains unverified by the agent. No deployment or financial action.
