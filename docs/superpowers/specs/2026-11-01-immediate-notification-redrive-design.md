# Immediate notification completion recovery (issue #3500)

Status: implementation design, not deployed. The existing immediate-order
confirmation sends first and attempts to record completion with an HMAC proof.
If the database secret is absent, the void completion RPC can no-op until the
claim becomes reclaimable. The current email-attempt audit writes are
best-effort and cannot establish that a missing accepted row means no send.

## Required behavior

- Persist a lease-bound dispatch record before the provider call. If that
  record cannot be established with server-only authority, do not dispatch.
- Record confirmed provider acceptance against that exact order, merchant,
  lease and attempt. A redrive for a confirmed acceptance only records
  completion; it never invokes email delivery.
- Preserve an explicit unknown state if the provider call or acceptance write
  is indeterminate. Neither a stale claim nor a missing audit row makes that
  state safe to resend. Surface it for reconciliation and operator attention.
- A definite pre-dispatch or provider rejection may release the claim only
  after the same attempt is durably identified as not sent. Lease rotation
  must fence stale workers from changing a newer attempt.
- Claim acquisition and dispatch creation must serialize on the same order
  claim. An accepted or unknown dispatch record prevents stale-lease reclaim;
  checking for it outside the claim transaction leaves a duplicate-send race.
- The redrive survives the five-minute secret provisioning interval and
  resumes idempotently after a worker or database restart.

## Authority and rollout

The public tracking token and claim lease are insufficient evidence that the
server sent an email: a caller who holds them must not be able to forge a
confirmed acceptance. The existing completion HMAC cannot be the sole
authority for durable acceptance because the missing database HMAC row is the
failure being recovered. Use an independently authenticated, restricted
PostgREST worker role for the sender and redrive, with narrowly scoped RPCs.
The server must validate its endpoint and worker-role token before use; the
bearer credential remains server-only. Do not extend the existing service-role
exception to the user-facing route. Require
explicit grants, deny direct public table access, RLS, fixed search paths and
cross-merchant and stale-lease tests. Credential provisioning and production
activation are separate release prerequisites.

Do not enable the new sender before the role, request hook, RPCs, worker JWT
and redrive cron are installed and their smoke checks pass. The new path fails
closed before sending if its credential or durable transition is unavailable;
enabling it without those prerequisites would suppress confirmations. Preserve
the previous sender path until an explicitly controlled, verified cutover.

The current PostgREST pre-request hook is already used by the GIGL restricted
worker. A new role must be incorporated without replacing or weakening that
hook, and must be restricted to its own reviewed method/path allowlist even
when other functions retain `PUBLIC` execute grants. Install and verify the
hook across the serving fleet before granting the new role to `authenticator`;
an asynchronous schema reload after the grant would otherwise expose a window
of broader access. Test allowed and denied paths for both worker roles and
preserve the GIGL hook's existing reload canary and deployment gates.

The writer begins an attempt only while the existing order/merchant and lease
match, then marks acceptance only for the same attempt after the provider
confirms it. A separate idempotent recovery RPC may mark the existing claim
`sent` only when that acceptance record exists and still identifies the
appropriate lease; it never accepts a caller-supplied `sent` assertion or
needs the shopper's tracking token. If the lease has changed, quarantine the
conflict for reconciliation rather than completing the new claim. The cron
worker receives only bounded recovery metadata and cannot dispatch mail.
The list RPC must prioritize actionable accepted rows ahead of unresolved
unknown rows so an old unknown backlog cannot starve safe completions;
separate aggregate monitoring must expose unknown backlog even under that
priority. Apply the row limit in SQL, not only after response validation.

The existing `beforeTransportDispatch` and `resetTransportDispatch` hooks may
support the dispatch fence, but their retry and exception semantics must be
verified end to end. A provider `client_reference` is not proof of idempotency
or delivery; do not assume either without provider evidence. Existing
processing rows have no new dispatch record, so migration and rollback need a
conservative policy that does not infer that a previous send did not happen.

## Required validation

Exercise real database transitions and the notification caller: absent HMAC
followed by provisioning; accepted send and lost completion response; a crash
before dispatch, after dispatch and after provider acceptance; unknown provider
outcome; definite rejection; duplicate redrives; simultaneous redrives and
claim races; stale lease and cross-merchant attempts; and a failed persistence
write. Verify no redrive calls the email sender for accepted or unknown
attempts, no anonymous caller can forge acceptance, and a recovered accepted
attempt becomes terminal. Include an operator procedure for unknown states
and backlog alerting, with no secrets or recipient details in logs.
