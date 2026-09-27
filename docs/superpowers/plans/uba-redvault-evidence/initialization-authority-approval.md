# Narrow initialization authority approval — 12 September 2026

The owner replied “yh” to the request to authorize the Ogabassey REDVAULT scoped initialization paths and the reviewed orders-route source receipt. This does not authorize activation, deployment, remote migrations, real payments, or service-role transport.

## Change reviewed

- Exactly three credential paths were added: initialize route → REDVAULT initializer → payment-attempt context → scoped JWT → existing signing material → environment; and the two suffix paths beginning at the initializer and context helper.
- The signer implementation, signer receipt, service-role permissions, and boundary-checker implementation are unchanged.
- The context helper now rejects any merchant other than the immutable Ogabassey ID before signing, creating a scoped client, or taking the test fallback. The existing short-lived authenticated-role customer claims remain unchanged.
- The orders-route diff was reviewed for availability gating, merchant validation, canonical server pricing, unsupported-combination rejection, and protected draft dispatch. Only its frozen receipt changes: `b9bab13947d81c13b08bd8cd61904fc0cddd75ad510e1079fb4e23e51da43e3f`.

## Verification

- Live repository boundary verification passes (154 seed paths). Log: `/private/tmp/redvault-authority-live.log`.
- Before the fix, regression tests reproduced unauthorized initialization authority and another merchant reaching the context helper without rejection.
- After the fix, eight focused suites / 209 tests pass, including orders, initialize, helper, manifest, and boundary tests. Sibling routes, shortcut paths, and service-role factory imports remain rejected. Log: `/private/tmp/redvault-authority-final2.log`.
- Aggregate lint and typecheck pass; `git diff --check` passes. Logs: `/private/tmp/redvault-authority-lint-final.log` and `/private/tmp/redvault-authority-types-final.log`.
- This is not a new full-monorepo passing result. Earlier aggregate test failures and external release gates remain documented in `integration-review.md`.

## Not completed by this approval

Availability remains disabled. Successful eligible-payment approval and atomic paid/redemption completion, authorized recovery/refund transport, provider acceptance/settlement evidence, full database replay, and actual web/native end-to-end acceptance remain outstanding. A local ledger hold cannot guarantee a provider settlement hold.
