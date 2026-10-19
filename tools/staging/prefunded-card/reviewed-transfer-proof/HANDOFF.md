# Rich transfer verification: bounded source handoff

This is source-only work. No remote connection, provider request, transfer,
payment, receipt replay, SQL execution, grant, migration, phase reset or timer
change was performed by this lane. Tests use mocked fetch and synthetic IDs.
The owner collector is a library, not a live completion driver or SQL renderer.

## Implemented boundary

`normalize-prefunded-card-transfer.ts` distinguishes the authenticated native
TSQ contract from the previously supported flat normalized contract. Native
`successful` is accepted only with an exact third-party reference, consistent
native ID/internal reference, positive safe-integer amount, zero fee, distinct
source/destination, two authenticated active wallet GETs and an independently
trusted ownership/crosswalk snapshot. Business and currency come from those
wallets; rich `customer_id` must match the authenticated business. Destination
customer comes from the proven crosswalk, never from the expected claim alone.
Wallet public identity, app merchant/customer/integration/goal, physical database
identifier and the enabled binding must all agree. Reads and binding observation
must be no older than 60 seconds; future reads and expired crosswalks refuse.

`collect-prefunded-card-transfer-proof.ts` uses the existing authenticated,
bounded, no-store, redirect-refusing GET helper. It performs no POST. The generic
flat contract remains available, with all original exact tuple checks and
rejection of contradictory optional references or fees.

`collector.ts` requires root, two ORIGINAL artifact byte arrays (not digest
assertions), both fixed SHA-256 pins, the fixed target scope/operation/amount/
references, the physical database pin, exact native provider transaction ID,
and a private approval that expires within 60 seconds and before the fixed
October 6 deadline. Artifacts are bounded to 1 MiB each. It forces the RICH
contract: a flat receipt is refused even if it contains the expected full tuple.
Successful owner collection necessarily calls `readReviewedOwnership` and both
wallet GETs. Output contains normalized evidence, `verifiedAt`, the original
approval `expiresAt`, both artifact hashes and `writesPerformed=false`.
No provider signature is created, copied into normalized evidence or asserted.

The owner callback must obtain the current NEW-goal binding from a trusted,
independently authenticated database read, not the historical old-goal snapshot.
It must reconstruct the reviewed crosswalk from the authenticated historical
identity artifact. The collector accepts only the pinned API alias, webhook
customer, identity hash, owner-reviewed authority and unexpired fixed deadline;
the shared normalizer checks every relation to the fresh claim and wallet GETs.
Root/callback access is a trust boundary, not cryptographic provenance by itself.

## Parent private loader and completion gate

The parent owns authentication, artifact custody and execution approval. Read
each original root-private artifact without following symlinks; require a
root-owned regular file, mode 0600, one link, bounded size and unchanged metadata
through capture. Pass its original bytes to the collector. Do not reserialize
an artifact to manufacture a matching digest. Do not expose settings, raw
provider bodies, original signatures or returned financial proof on stdout.

Fixed identity anchor:
`/root/baci-interest-identity.5Qxbj342/collected-evidence.json`
SHA-256 `8d0a4f90a2f96182776baf91148b3bd3b27a3323eaff8d37362e24511b52d327`.
Fixed original TSQ audit anchor:
`/root/baci-financial-owner.2ynkl9kc/transfer-readonly-c771229341584d5c92416ede372447ee.json`
SHA-256 `1e724a50f87f9dec09a3922a16743f1afb8faff01dbec78a7716bf08917d94d8`.
These pins bind independently reviewed historical captures. They do NOT turn
their old timestamps into fresh provider verification: collection rereads TSQ
and both wallets, and the parent rereads the current binding.

For existing operation `ff561046-58e7-428d-9163-f6e60b0dab65` only:

1. Parent safely quiesces the active background consumer or obtains exclusive
   coordination. A live lease is a refusal; wait for natural expiry. Never clear
   tokens, reset fences/phases, disable triggers or start another transfer.
2. Parent authenticates the local Unix-socket postgres session and physical DB
   `7685292944002592802`. Before any write, its independently reviewed driver
   pins actual live routine OIDs/owners/ACLs/definer/source definitions and hashes
   the complete financial baseline, immutable operation and current mappings.
   Local source definitions are not proof of live function identity.
3. Rehearse in one transaction, default ROLLBACK. Retain the owner-approved
   cap/deadline, exact new/old goals, old principal 10000, retirement state,
   projection absence, operation state, saved method/auth binding and treasury
   baseline. No guard is waived just because the provider reports success.
4. Through the EXISTING authorized treasury session, use ONLY restricted
   `claim_reconciliation(operation,60)` for the existing transfer. Require
   `verify_only`, transfer leg, the exact returned immutable request, fresh token
   and fence. Feed the normalized proof to the EXISTING
   `complete_reconciliation(operation,token,fence,'transfer','verified_success',evidence)`.
   Recheck proof/approval/lease freshness immediately before completion. RESET
   session authorization in the parent's guarded connection. No submission,
   ingestion of an invented webhook, new grant or permanent routine rewrite.
5. Recheck full postflight and permanent metadata. This completion records the
   successful transfer and moves 10000 from treasury RESERVED to CONSUMED; it
   is not a no-financial-change operation. AVAILABLE/cap and old-goal principal
   remain unchanged. Any credit/projection is a separate existing idempotent,
   independently guarded step; proof collection does not perform it.
6. Parent retains a private rollback receipt covering the full exact scope,
   proof/source/function/baseline digests and fixed expiry. Apply only after
   independent review of that matching rollback, parent approval, unchanged
   preflight and freshly recollected actual proof. A stale/replayed/foreign
   claim, changed baseline or unexpected completion result means ROLLBACK.

This library does NOT implement those SQL/session/financial guards, collect the
live function pins or certify a rehearsal. The parent must supply its existing
guarded driver. No apply mode or completion executor is exposed by this library.

## Runtime wiring remains missing (explicit gate)

`prefunded-card-execution.ts` accepts an optional trusted ownership resolver.
`prefunded-card-composition.ts` currently supplies NONE. Therefore an unattended
native rich response still defers. This source fix is NOT automatic live
recovery, a deployment, or completed runtime wiring. The execution regression
asserts that absence does not call completion or resubmit the transfer.

The generic provider accepts only `provider_authenticated_crosswalk` authority;
the one-time `owner_reviewed_provisioning_identity` path is deliberately rejected
there. Do not relabel historical owner review as authenticated provider proof.
Do not equate an API alias with a webhook UUID or manufacture expected values.

A later runtime resolver needs immutable independently authenticated provider
evidence plus the trusted current app binding. If implemented as a read-only
restricted RPC, it must derive session scope from an existing exact authorized
binding, check the physical DB and full tuple, enforce enabled/unexpired state,
return only the proven relation and source digest, and expose no public/service
role grant or caller-controlled evidence assertion. It requires an independently
reviewed append-only migration, exact-role tests and explicit composition wiring;
none was created or applied by this lane.

## Newly reported original signed event stays distinct

Parent reports original AEAD and HMAC-SHA512 validation of receipt
`0f9938ae-8551-4e2e-8816-853e0231b2c3`, with root audit
`/root/baci-financial-owner.2ynkl9kc/signed-transfer-readonly-29ee22b014c04aeb98a229bc51b674b8.json`
SHA-256 `d7c41bf04af9b1482c850d240ca190d9edd7484cbc04c868ab1626cea5583f14`.
This lane has not read/decrypted that artifact or verified its original HMAC.
It is not silently substituted for either collector anchor or runtime authority.

The signed `wallet-transfer.outflow.success` event carries webhook customer UUID
and FAAS source/destination identifiers. Native TSQ carries PUBLIC wallet IDs
and `customer_id` representing the business. Their identifier namespaces are
not interchangeable. Native provider transaction ID remains
`PVB01M3YP6SFJQTJQWE83SC5RMX1V`; signed event `transaction_id`, event `id`,
provider `reference` and the native third-party app reference are distinct.
Parent must authenticate the original exact bytes/config, validate event kind,
amount/currency, exact public/FAAS pairs through authentic wallet reads and
resolve the original initiator/internal/third-party reference semantics before
designating this NEW event an authoritative generic crosswalk. Neither a hash
nor a supplied authority string performs original signature verification.

## Interest bridge remains a separate approval

The source `interest-bridge/test-plan/plan_constants.py` matches this lane's app
scope, API alias, webhook UUID, destination public/FAAS wallet and identity pin.
That is a local source consistency check, not a live mapping read. The existing
new-goal binding must be independently checked live. Do not remap the old funded
goal or borrow foreign/sample identifiers. Interest-enabled provider balance is
not an app interest credit or approval to install a payout policy.

Minimal true-interest path: authenticate this exact wallet's eligibility and
customer opt-in; obtain the independent payout source/namespace/destination
mapping plus reviewed 900 customer/300 business annual-basis-point contract;
prepare an inactive exact-scope policy, rehearse existing guarded installation
and only activate after parent approval. Real interest comes only from a genuine
provider interest event independently reconciled through the installed policy.
Never credit the synthetic gross/tax/net fixture or split customer net twice.

## Inventory and local evidence

`SOURCE-SHA256SUMS` inventories every owned TS source/test and this handoff.
`collector.test.ts` is colocated here and covers root, paired byte pins, target
scope, approval expiry/deadline, wrong owner/TX, sanitized failures and the flat
bypass. All fixture IDs and artifact bytes are synthetic; only fixed target
constants contain owner-specified real identifiers.

Measured RED: rich successful response deferred before implementation; a
contradictory flat third-party reference was accepted before schema hardening;
the owner flat-bypass regression resolved before the rich-only gate. Each now
passes. Focused checks and exact counts are recorded in `VALIDATION.md`.
No full build, dependency installation or permanent SQL changes were performed.
