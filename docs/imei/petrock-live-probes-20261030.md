# Authorized Petrock diagnostic probes — 2026-10-30

Supplier-test cap: **US$5**. These direct reseller requests did not debit a
customer wallet, alter customer prices, activate services or prove application
callback/notification delivery. Every product was submitted once with a unique
reference. Raw responses and identifiers remain private; only sanitized fixtures
and non-sensitive coverage notes are committed.

Status snapshot: 2026-10-30T06:51:38+00:00.

| Product | Diagnostic | Reserved USD | Observed state | Release disposition |
| --- | --- | ---: | --- | --- |
| 1941 | eSIM compatibility | 0.04 | success | Captured promised fields; scoped iPhone IMEI rollout |
| 716 | SIM-lock status | 0.06 | success | Captured device model and Unlocked status; no hardware model-number promise |
| 1966 | Replacement device | 0.04 | success | Replacement Device No does not establish replacement history; stays disabled |
| 666 | Apple premium/photo report | 0.74 | in-process | Pending supplier completion; stays disabled; never resubmit automatically |
| 1963 | Apple part number | 0.12 | success | Captured partNumber only; no invented model/device/safety data |
| 1943 | Full GSX report | 1.40 | success | Successful supplier report does not yet establish every mapped tier promise; stays disabled |

Conservative total reserved: **US$2.40**. Remaining budget: **US$2.60**.
Pending charges remain counted against the cap until reconciled. No supplier
refund or customer checkout completion is inferred from submission success.

Initial Petrock allowlist: `simLock,esimCompatibility,applePartNumber` after the
reviewed migrations, signing-secret provisioning and synchronized web/worker
deployment. Paid unlocking remains disabled. The other 20 new diagnostic
candidates remain dark; existing blacklist checks stay on Sickw because the
earlier Petrock blacklist probe was rejected.
