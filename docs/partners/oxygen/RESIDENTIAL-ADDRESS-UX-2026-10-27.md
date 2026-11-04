# Residential address in the initial details flow

Collect the home address and matching proof beside employment/income fields.
Suggest the caller-owned checkout address only for explicit door delivery, and
require the customer to confirm that it is their residence. Pickup/station/airport
and unknown delivery modes start blank. Never modify the order's delivery address
when the customer changes their residential address.

Reuse the existing AddressAutocomplete (Google Places/provider fallback); all
fields remain manually editable. Places cannot reliably supply LGA or landmarks,
so do not infer either. Store residential text in the existing authenticated,
AES-GCM encrypted draft. An authenticated read-only projection can recover only
residential text after the workflow progresses; identity numbers remain private.

Proof files remain in memory scoped to the active workflow, not in localStorage,
draft JSON, logs or analytics. Validate PDF/JPEG/PNG and a maximum of 1,500,000 bytes.
If the tab reloads before transmission, recover the saved address but ask the
customer to reattach the proof. Durable encrypted proof storage remains future
work; this implementation does not claim documents survive reloads.

Once Oxygen has booked a plan, submit the confirmed address and proof through the
existing submit_address action. Do not submit before booking or reissue an
unconfirmed request automatically. Existing idempotency, response evidence,
telemetry, reconciliation and address-status polling remain in force. Show the
verification activity while sending/checking. Identify the failed operation with
safe copy; retain detailed provider diagnostics in the existing private evidence.
Address submission does not verify BVN/NIN, approve, activate, settle or cancel.

Previously booked applications without a prepared proof use the redesigned address
form in the same popup. No new application or booking is needed for recovery.
Do not obscure a missing proof by showing an endless loading state.

No database migration, new SDK, credentials, provider retry, deployment or
activation/settlement flag change is needed for this UI change.
