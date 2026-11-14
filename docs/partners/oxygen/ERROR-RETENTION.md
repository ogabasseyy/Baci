# Oxygen workflow error evidence

Oxygen workflow failures are recorded against the **specific durable command**, never inferred from the last error seen for a customer. This applies to authenticated checkout/chat workflow execution and callback reconciliation. Activation and settlement are still disabled; this feature makes no provider retries.

## What is retained

- Command, workflow and order identifiers; operation/action and final failed or indeterminate status.
- Application/booking references known at that attempt, for provider escalation.
- Database-recorded time, command start/completion times and provider observation time/duration.
- Provider HTTP status, short response code, sanitized top-level message and an allowlisted correlation identifier, when supplied.
- An explicit capture classification when the response is oversized, non-JSON or unavailable. Transport, authentication and validation failures are distinguished from HTTP rejections.

Request/response bodies, authorization/cookies, files, hosted links, OTPs, identity numbers and bank details are not recorded. Text redaction removes known request values and credentials, emails, URLs, identifiers and numbers. Free-text messages are sanitized evidence, not necessarily byte-for-byte copies of the provider response. Unknown fields are dropped. Review the sanitized report before sharing it externally.

Successful responses do not create error evidence. Public customer responses continue to contain static safe messages; operator diagnostics are never attached to customer snapshots, analytics or normal API responses.

## Storage and access

`oxygen_private.attempt_diagnostics` has RLS enabled and no direct grants for customers, anonymous users or ordinary authenticated users. The RPC boundary authenticates the enabled staging worker for the workflow's merchant. Another worker cannot read or write another merchant's evidence.

`oxygen_finish_failure` commits the failed/indeterminate intent and sanitized diagnostic in **one transaction**. If recording is unavailable, the claim remains unresolved and the application must reconcile before replaying a possible mutation. A static server log with command/workflow IDs reports evidence-write failure, without provider or database error text.

Reports expose a 90-day window, capped at 100 entries per workflow. Expired entries are physically pruned for that merchant when another failed attempt is recorded; this is opportunistic cleanup, not a scheduled hard-deletion guarantee. No new production worker or production access has been provisioned.

## Export an escalation report

Use the existing ordinary staging worker's private runtime config, with owner-only filesystem permissions. Do not paste credentials into the command or commit the config. Run from `apps/web`:

```sh
NODE_OPTIONS=--conditions=react-server pnpm exec tsx tools/oxygen-workflow/error-report.ts \
  --config /absolute/private/runtime.json \
  --workflow WORKFLOW_UUID \
  --out /absolute/private/oxygen-error-report.json
```

The export is created with mode `0600`, refuses to overwrite an existing file, and contains only that workflow's retained failed attempts. Omit `--out` for JSON on stdout. The operation reads storage only; it does not contact Oxygen, resend OTPs, refresh eligibility or book a loan.

An empty report means no retained error evidence exists in the window. Historical responses lost before this migration **cannot be reconstructed**. Do not substitute an older captured error for a newer command. New upstream errors will be retained as they occur; do not generate financial attempts just to populate the report.

## Verification

- Provider tests cover exact non-sensitive errors, numeric response codes, request-specific redaction, credentials, multipart fields, body-size limits and non-JSON responses.
- Runtime tests verify atomic evidence RPC use and no replay on uncertain failures.
- Disposable SQL tests verify worker scope, customer/cross-worker denial, strict projection, version/status atomicity and expiry filtering.
- Staging deployment uses the appended `20261023064641_oxygen_attempt_diagnostics.sql` migration. Local application code and operator retrieval are separate from any production deployment.

## Customer-facing failure states

The observed HTTP 400 `OTP validation failed. Please try again` response from
`validate_existing` or `validate_new` maps to the static `OXYGEN_OTP_INVALID`
code. Its message appears beside the OTP input, with `aria-invalid` and an
associated error description. Network errors, HTTP 500 responses and unrelated
validation errors must not be described as an incorrect OTP. Full sanitized
attempt diagnostics remain operator-only.

A reconciliation-required or executing/indeterminate result replaces the form
with one confirmation notice. The optional update action and bounded automatic
polls only read the saved snapshot; they never resend a booking or OTP. The old
operator-oriented pending-step messages and generic retry card must not render
alongside that notice. Activation and settlement remain disabled.
