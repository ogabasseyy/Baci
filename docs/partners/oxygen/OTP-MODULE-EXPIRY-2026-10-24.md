# OTP module and five-minute expiry

Oxygen's five-minute OTP lifetime was confirmed by the owner on 2026-10-24.
The shared web component lives in `apps/web/src/components/ui/otp-verification`;
Oxygen retains a compatibility export. Labels and 4/6-digit lengths are configurable.

The countdown requires an absolute `sentAt`. It must not start on mounting or
reopening. The default validity is 300 seconds, configurable for other providers.
The browser catches up from the absolute deadline after suspension, blocks expired
completion and hides expired digits. Verification remains controlled by the server.

For approval OTPs, the customer-owned `oxygen_approval_code_window` RPC projects
only booking reference and timing from the existing successful command ledger and
reference history. The latest matching reference wins; another loan's newer request
cannot replace it. Request-start time is used conservatively. Missing timing or an
indeterminate resend does not invent a fresh expiry. No tokens or code values are
returned. Migration `20261024133000` was applied only to isolated staging.

The popup uses that metadata and offers an explicit resend for the same reference
through the existing durable workflow action. There is no new provider mutation
endpoint. Success resets the displayed code and reloads persisted timing. Failed or
uncertain resends neither restart the window nor retry automatically. Five minutes
is validity, not a presumed resend cooldown. Other providers' sign-in flows retain
their existing timing until they supply their own acknowledged send timestamp.

The simulation uses its own local demo timestamp. The real Verify and approve plan
button remains disabled. No approval, cancellation, activation or settlement was
performed while implementing expiry; the old indeterminate-command fingerprint
remained unchanged. The previous approval code now correctly shows expired.

Verification includes module countdown/reopening/background-clock tests, duplicate
and failed-resend coverage, exact-reference panel tests, authenticated route tests,
and a transactional SQL regression for customer ownership, reference matching,
five-minute timing and indeterminate resends. The SQL fixtures roll back.
