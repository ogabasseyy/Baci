# Staging OTP resend recovery — 22 October 2026

The runtime accepted only lowercase `message` in the OTP resend acknowledgment.
The earlier live provider probe had already observed uppercase `Message` with
`OTP retriggered for validation` (see LIVE-VALIDATION-2026-10-07.md). A resend
whose response cannot be parsed remains indeterminate, blocking further commands.
The original failing response body was not retained; the casing mismatch is a
supported explanation, not a retrospective delivery receipt.

The new resend response schema accepts either known spelling with that exact
acknowledgment, rejects missing/unknown/conflicting messages, and leaves unknown
mutation outcomes blocked. A successful status refresh also clears stale request
errors in the customer view.

## Isolated staging repair

Order `108497c7-a91c-4f72-b3cf-410ed6800fb3` retains its original workflow and
provider reference. The unconfirmed resend intent was explicitly abandoned using
`supabase/operations/oxygen-recover-resend.sql`. Its local `failed` status records
operator abandonment, not a claim that Oxygen rejected or did not deliver it.
The original reconciliation history remains, with a new recovery history row.
No customer/provider payload was replaced and no booking/payment state changed.

The script defaults to rollback and checks exact workflow version, staging-only
scope, unpaid order, unvalidated customer, exact resend action, indeterminate
status, absence of other pending commands and absence of booking/payment/setup.
A rolled-back rehearsal passed; targeting the original start-application command
was rejected. The exact OTP-only repair was then committed on the isolated DB.

One new user-authorized resend was made through the normal authenticated UI/API.
It finished `succeeded`; the workflow returned to `eligibility_required` at version
4 with no pending command. This confirms Oxygen acknowledgment, not SMS/email
delivery. No OTP was entered by the assistant. No activation or settlement was
performed or enabled. No production change is implied.

Validation: 724 focused tests pass, changed-file Biome and web typechecking pass.
