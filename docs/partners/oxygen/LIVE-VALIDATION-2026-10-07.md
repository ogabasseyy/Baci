# Oxygen → Ogabassey: observed integration evidence

7 October 2026. Local operator test UI against the user-authorized production partner. No credentials, tokens, customer values, account names or raw responses are recorded here.

| Step | Evidence | Integration implication |
| --- | --- | --- |
| Partner authentication | HTTP 200 observed; documented token expiry previously observed as 300 seconds. Reauthentication succeeded in this session. | Keep credentials and token handling on the server; refresh authentication before expiry. A preflight expired-login rejection must not lock an unsent application. |
| Bank list | Authenticated GET `/v1/eligibility/banks` returned 44 entries in this session's earlier check. `Result[].Name` + `SortCode` populated the selector. | Show actual provider banks; derive bank name/code together. |
| Account name | Authenticated POST `/v1/partner-loans/name-enquiry` returned HTTP 200 with successful name resolution during this probe. The local form received the name; no value is recorded here. Response included nullable `bankCode` and `currencyCode`; do not require those optional values to resolve a name. | Resolve after valid bank/account/phone inputs; clear stale names on input changes. Debounce user typing, handle stale responses, avoid automatic retry after provider failure. |
| Loan-request creation | User-clicked Create returned HTTP 400 with generic error fields. Earlier implementation discarded the message and exposed types only. No loan reference was retained by the client. | Not successful or reconciled. Do not guess the validation cause or blindly retry. The payload field structure matches the reviewed create documentation, but required/optional and business validations are not fully specified. |
| OTP, selfie, eligibility | Not reached in this live attempt. | No end-to-end loan, approval or eligibility success claim. |
| Booking/activation/fulfilment | Not probed. | No production transaction/dispatch claim. |

## Diagnostics improvement

The next test-run server build returns bounded redacted error wording for unsuccessful responses: known partner credentials/tokens, submitted string values, email addresses and digits are masked. Text is displayed only in the operator UI, never logged or persisted. Unknown provider fields are not echoed wholesale. It is operator diagnostics, not a public checkout error contract. Two diagnostics regression tests fail with a runnable stub and pass with the implementation.

The current runner was deliberately not restarted: its creation lock and existing error-session state must be preserved. New diagnostics therefore apply to a future runner, not retroactively to the discarded HTTP 400. This probe refreshed authentication and resolved account name; it did not resubmit Create, accept terms, validate an OTP, assess eligibility or create/activate a loan.

## Small remaining provider request

In the existing partner conversation, report that production authentication, banks and account-name enquiry work. Ask Oxygen to identify the business/validation reason for the user's HTTP 400 create attempt in their logs, and confirm whether any customer/request record was created before advising a retry. Supply identifying details privately through the provider's approved channel; do not post credentials or BVN/NIN in chat.

Ogabassey can use the proven lookup contracts now. Customer checkout initiation remains default-off until successful application/validation and remaining readiness, terms, recovery and fulfilment contracts are established.

Local verification of the diagnostics update: 621 affected tests pass; web lint/typecheck pass; diff checks pass. CodeRabbit completed with 0 issues. These checks are distinct from the live account-name success and do not substantiate a successful loan application.

## Explicitly authorised lookup rerun

The user requested click-through testing with their filled details. The assistant reran authentication, which completed and triggered successful account-name enquiry. Bank-list lookup was then repeated: HTTP 200, 44 banks. The selected bank was restored, triggering a second successful account-name enquiry (HTTP 200, account name filled). Only these safe response codes/shapes and counts were inspected and recorded; no customer values, credentials or tokens were logged. Create remained disabled throughout. No loan submission, OTP, selfie, eligibility, booking, terms acceptance or activation was performed. The original create HTTP 400 cannot be retroactively diagnosed because its error wording was discarded.

## Successful user-driven creation and existing-customer flow review

The user subsequently reported request creation and OTP delivery. The local UI independently showed HTTP 200, `request_created`, and `customerPath: new`, with response fields `token`, `message`, `loan_request_reference` and `partner_reference` (values not read/recorded). This is live evidence of a successful new-customer creation response and an observed source for its validation token; it is not evidence of successful OTP validation, KYC, eligibility, booking or activation. The current server retains the request reference, original phone and validation token in memory. Do not restart it or create another request while this participant completes validation.

The official loan-requests-and-validation page was reread. Both customer paths start at POST `/v1/loan-request/create`. The examples distinguish existing users with `OTP sent for validation` and new users with `Customer creation initiated`; they describe these as usual messages, not a stable machine-code contract. Existing validation uses POST `/v1/loan-request/validate/existing/user` with phone, OTP, loan-request reference and partner reference. New validation uses POST `/v1/loan-request/validate/new/user` with those inputs plus token. The existing-customer flow then uses selfie verification for KYC. Separate existing/new OTP-retrigger endpoints are documented, but retrigger is not implemented in this local UI.

The current tool already implements both OTP validation endpoints with references/phone held server-side and a retained token for the new-user path. It currently exposes both buttons: the operator must select the observed path. For this live request use **Validate new customer**. Further production integration should select the supported path from the trusted provider response, fail closed on unknown response messages, and avoid inferring customer category solely from an email collision. The HTTP 400 `Email is already taken.` was observed on the rejected attempt; it does not establish the provider's identity-matching/reuse rules.

No email change, new Create, OTP validation or provider call was performed by the assistant during this review. No runtime code changed, so the active request/session was preserved.

## Saved checkpoint requested by the user

Checkpoint: successful new-customer creation (HTTP 200) was observed and the user reported receiving the OTP. The full original form was cleared by the UI after successful creation; later inspection showed only bank-name/code fields still populated. Original customer values are therefore not recoverable from the current form and were not copied into this evidence file. The current server retains the original request reference, phone and new-user token for OTP validation in memory. No re-entry of the full form or new creation is required for that step. This is session continuity, not durable recovery: do not stop/restart the local runner before validation. No OTP, token, credential or customer identifier was persisted by this checkpoint.


### Resumed request and OTP resend (7 October 2026)

The active new-customer request was preserved privately in memory across the local runner update. No identifiers, tokens, keys or original form values were printed or written to files. The temporary task-owned loopback debugger was closed after capture. A validated resume contract restores the existing reference and customer branch, keeps Create locked, and exposes only request-presence and branch to the UI.

The assistant refreshed partner authentication successfully and invoked one user-authorized POST to `/v1/loan-request/retrigger/otp/new/user` using the preserved request and partner references. Oxygen returned HTTP 200 with shape `{ "Message": "string" }`, rather than the documented lowercase `message`; the UI correctly reports `unknown_resend_response`. Exact message text was not retained, so accepted resend or SMS delivery is not claimed. No automatic retry, new application, OTP validation, booking or activation was performed. The user should use the latest SMS if received and validate the new-customer request manually.

Validation: 626 affected tests pass, web lint/typecheck pass, diff check clean, and CodeRabbit completed with zero findings before runner update.


### Explicit existing-customer OTP resend comparison

At the user's explicit request, one POST to `/v1/loan-request/retrigger/otp/existing/user` was made using the same active application reference and partner reference, after refreshing authentication. HTTP 200 returned `Message: "OTP retriggered for validation"`; only sanitized message, status and field names were reported. No new application or OTP validation was submitted. This confirms provider acceptance of this resend request, not SMS delivery or a transition of the application's customer branch. The temporary task-owned loopback inspector was closed before provider calls; private context remained in memory only.


### Full validation-error inspection

A subsequent user-submitted new-customer validation was inspected at the local response boundary. Oxygen returned HTTP 400 with message `Account validation failed`, error `Bad Request`, empty path, `errors: null`, and `response_code: null`. The remaining body field was the timestamp. Headers contained transport/cache/security/service-routing metadata, with no additional validation reason or correlation identifier. Only redacted diagnostic output was emitted; the raw response and private request context were not written to files. The temporary loopback inspector was closed after inspection. This establishes that the omitted error value was generic, not a field-level explanation; it does not identify why validation failed.


### Separate participant attempt — 8 October 2026

A separate local runner on port 3418 preserved the original port-3417 request. The user submitted a new application with a different email; UI evidence showed HTTP 200, `request_created`, `customerPath: new`, and response-field types for token/message/request reference/partner reference. The user reported receiving a fresh OTP. After the assistant populated the local OTP input, the user submitted new-customer validation. UI evidence showed HTTP 200, `response_received`, with a single string `message` field. Its exact text was not retained, so this records a successful HTTP validation response rather than a verified specific message or downstream KYC state. No identifiers, OTPs, BVN/NIN or email values are recorded here. Selfie, KYC and eligibility remain unverified.


The subsequent selfie-link request returned HTTP 400 with sanitized message `BVN already exists`. KYC status returned HTTP 200. One explicit status-read repeat inspected only bounded non-identifying status values: `address_status: NOT_DONE`, `selfie_status: NOT_DONE`. Both remain incomplete. No selfie link was obtained, biometric upload or eligibility check performed. An existing-BVN response does not establish completed KYC or the reason the customer creation path was selected.

### Existing-customer recovery probe (2026-10-08)

Owner explicitly requested an existing-customer test against the preserved request. A local checkbox enables this diagnostic option without changing the original new-customer classification. The existing-user OTP retrigger endpoint returned HTTP 400, message `Loan request has been validated`. No existing-customer validation was submitted; no fresh OTP was reported by the provider. This establishes that the provider considers the request validated, while selfie recovery remains unresolved. Regression test failed before implementation and passed after it; all 36 manual-tool tests and web lint/typecheck pass. CodeRabbit review completed with zero findings across 64 files.

### Private selfie payload inspection (2026-10-08)

One owner-authorized selfie-link request was inspected in memory. POST endpoint matched the configured production base plus documented `/v1/loan-request/validate/selfie`; the only JSON keys were loan_request_reference and partner_reference. Both matched the current saved request/configuration. Bearer authorization matched the current unexpired token after successful refresh. No private values were emitted or written. The full JSON response contained only timestamp, path, message, errors, response_code, status and error. HTTP 400: BVN already exists / Bad Request; errors and response_code null; no URL or extra body fields. Header names were routine HTTP/security/envoy metadata; values were not retained. No documented request-field mismatch was found. This does not establish the provider internal root cause or prove a customer mapping fault. Temporary instrumentation restored the original fetcher and closed its inspector.

### Bank-switch continuation prepared (2026-10-08)

Provider partner-thread screenshots confirm bank changes require a fresh loan request with changed details. Owner requested testing continuity. A separate local test on port 3420 restores the owner-authorized browser draft, selects Access Bank (044), and clears the prior bank account number. The successful GTBank request on port 3419 remains intact. No new application was submitted by the assistant. Access account number and fresh customer consent are required before owner submission. This is a manual continuation test, not production application persistence or a verified complete bank-switch lifecycle.
