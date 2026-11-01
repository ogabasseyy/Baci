# VTU authenticated admission (#3694)

Wallet-only checkout now obtains its admission proof through the authenticated
client. The RPC derives the caller from `auth.uid()`, resolves the merchant slug
or alias, and uses the same private verified-customer resolver as preparation and
claim. The snapshot includes only mappings and transactions belonging to that
merchant/customer pair and matching the request fingerprint. The transaction's
merchant/customer must also agree with its mapping. Anonymous and missing-UID
calls fail closed. A missing customer returns an empty live set; preparation
still owns customer creation/linking. No buyer SELECT policy is added.

The DB statement timestamp and live IDs are still captured under the same stable
statement snapshot. A terminal transaction that was live at admission remains
eligible for the existing intent claim even when its terminal writer's transaction
start predates admission. Existing-key replay remains available if proof lookup
fails; a fresh key fails before preparation. The route never returns the proof.
Trusted service-role admission callers retain the previous merchant scope for
compatibility, but the wallet-only route no longer uses that capability.

This is one part of the epic. The server-computed prepare insert remains
service-role-only: granting buyers permission to submit settlement commissions,
cashback or payment splits would allow money forgery. Fulfillment still needs
its wallet/ledger/provider-state operations and notification/loyalty writes.
The existing temporary exception remains until those operations have a verified
restricted boundary. No secret provisioning or production rollout is included.

Verification: the focused API/admission tests cover authenticated transport,
proof failure, replay and overlap behavior. The native PostgreSQL harness runs
the actual admission migration, customer resolver and intent claim on minimal
synthetic tables. Its SQL suite also runs under canonical schema replay in CI.
The native harness does not contact a provider or move funds.

Run locally with PostgreSQL 17 installed:

```sh
node tools/test/vtu-admission-customer-scope-local.test.mjs --baseline
node tools/test/vtu-admission-customer-scope-local.test.mjs
```

The baseline is expected to fail because authenticated admission was denied.
