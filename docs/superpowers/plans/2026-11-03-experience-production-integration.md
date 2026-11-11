# Production integration, disabled local release candidate

Base: main `930ecba11c54073caec652e2257e02be2ce80532`.
Reconciled again to `932a38e053f7b123a5d137298a2e26c0dc87c156`; the 143 upstream
PiggyVest paths had no overlap with this work.
Final reconciliation: `7a2f3cc9b1f610d33b5c6da49147166f814e2404`; both sides of
the additive Turbo configuration overlap were preserved.

Keep authored code unrestricted within the existing isolated runtime; keep commerce,
merchant identity, quotas and build authority in Baci under normal auth/RLS.
No hosted activation, publishing, orders, payments, paid reviews or AI calls.

1. Add a bounded authenticated runner transport with explicit executor injection,
   fixed job kinds, expiring signed payloads and replay protection. Never forward
   browser credentials or fall back to host execution.
2. Extract an output-only private delivery handler suitable for an HTTPS ingress,
   retaining resource revocation, immutable bytes and opaque-frame CSP. Validate
   exact trusted origins; local gateway remains a thin loopback adapter.
3. Connect the production profile to the normal MCP build/preview ports with
   activation disabled. Preserve canonical merchant-origin binding and existing
   account-link/private-storage feature gates. Qualify public delivery separately.
4. Test normal owner/guest paths and adversarial inputs locally, then run targeted
   type/lint checks and the included free review. Record incomplete gates honestly.

Release still requires clean CWV qualification, a reviewed candidate at the current head,
infrastructure provisioning/HTTPS qualification and separately authorized rollout.
Passing mocked HTTPS tests does not demonstrate deployed TLS or production capacity.
