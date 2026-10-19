# Separate empty staging interest goal

## Executable boundary

`empty_plan_owner.py inventory|goal-rehearse|goal-apply|rehearse|apply` is an
owner-only executable. For the current unresolved payout namespace, use
`goal-rehearse` then `goal-apply` with `routing=null`. These create a separate
zero-principal opted-in interest goal, its official idempotency record and audit
event, the exact public-wallet mapping and restricted ledger binding, with **no
interest policy row at all**, including no disabled placeholder. Reports say
`exact_empty_goal_bound_policy_pending`, `interestPolicyPresent=false`,
`interestPolicyEnabled=false`, and `providerIdMappingApproved=false`. The latter
refers to interest payout routing; the bank-credit public-wallet identity remains
bound using the independently joined webhook customer UUID. This does not
authorize interest receipts, customer funding, or a later policy activation.

With valid exact routing proofs, full-policy `apply` commits a new empty
goal, its official idempotency record and `goal_created` audit event, an immutable
public-wallet mapping, a restricted treasury-role ledger binding, and an
**enabled** interest policy. It never installs migrations, grants access, creates
credentials, funds a goal, starts a pipeline, remaps the old goal, or inserts an
interest allocation/receipt. The manual contribution schedule is 1 naira/day;
initial contribution is zero, no saved payment method or auto-debit consent is
set, and no scheduled payment is created. The current exact catalogue variant
and price determine the purchase target, not a new funding authorization.

This is trusted owner provisioning through the existing authenticated creation
RPC, not a public write endpoint. The existing user authorization is recorded
in a fresh, scoped owner opt-in artifact. The parent asserts only the fixed actor
after checking its current customer linkage, invokes the RPC as `authenticated`,
then resets to the existing local database owner for the existing owner-only
mapping contract. It does not use `service_role` or fabricate provisioning
dispatch acknowledgements. All database guards remain enabled.

The parent-collected live schema at `2026-10-02T05:39:09Z` confirms the physical
database, actor, merchant, enabled savings feature, empty candidate mappings and
old binding. The actual creation RPC has 23 parameters including
`p_goal_idempotency_key`. Its definition MD5 `54329ee7d061c76bd1e7603d8597f7ee`
exactly matches the receiving repository's existing September 23 migration when
installed in disposable PostgreSQL. The feature RPC MD5 is
`2ce0c402532215657dc8e09492c57856`. Both definitions are pinned in the preflight.
Neither existing migration is edited or deployed by this bundle.

## Exact proof schema

Copy `approval.goal-only.template.json` for goal-only, or `approval.template.json`
for full-policy, outside the source directory into a root-private
audit directory. Its null values are intentionally refusals, not inferred
attestations. No additional keys are accepted. All referenced evidence files,
the completed approval, inventory, identity evidence and rehearsal receipt must
be regular, root-owned, single-link **0600** files with exact SHA-256 pins.

- `schemaMd5`, `stateMd5`, `snapshotObservedAt`: copy from this bundle's fresh
  `inventory` output, not the preliminary schema-only report. Review the complete
  schema fingerprint, including functions, triggers, constraints, indexes, RLS,
  ACLs and role metadata. Inventory expires after 15 minutes.
- `optIn`: all four acceptance fields must be true. `acceptedAt` records actual
  authorization for this new empty staging plan on/after October 2, not the old
  plan's consent timestamp. `reference` is an owner audit reference <=128
  identifier characters. Do not retroactively promote old-goal consent.
- `eligibility`: `eligible=true`, provenance
  `provider_authenticated_wallet_get`, the SHA-256 of a sealed parent-reviewed
  authenticated GET evidence artifact, and an audit reference. This is not a
  provider-signed eligibility letter. The executable independently repeats old
  and candidate wallet GETs through the pinned reviewed credential helper. Both
  must have the exact business/API customer/public/FAAS IDs; the candidate must
  be active, NGN, interest-enabled, balance **0**, withdrawal count integer 0..4.
  The new read expires after 90 seconds.
- `split`: provenance `user_forwarded_provider_confirmation`, scope
  `business_global`, `customerAnnualRateBps=900`, `businessAnnualRateBps=300`,
  `customerNetTreatment=full_customer_net_no_resplit`, SHA-256 and audit reference
  for the actual user-forwarded provider confirmation. It is not a per-wallet
  API rate, additional provider attestation, or authorization for another split.
- `routing`: a separately reviewed exact mapping artifact SHA-256 and reference;
  provenance `provider_documented_mapping`, `provider_signed_payout_mapping`, or
  `provider_authenticated_readback_and_documented_field_mapping`. Source
  namespace is `public` or `faas`, with the matching exact candidate ID. Payout
  customer namespace is `api` or `webhook`, with its exact independently joined
  alias. Destination namespace is `public`, `faas`, or `provider_ledger_uuid`,
  with the exact documented destination ID; UUIDs retain their hyphens.
  `sourceSemantics=interest_earning_wallet` and
  `destinationSemantics=customer_net_payout_wallet` are explicit reviewed claims.
  Equal source/destination is allowed only when independently documented, never
  filled from one another. The old funded wallet cannot be the destination.
  Goal-only requires the entire field to be JSON `null`; no routing proof is
  needed or attested. Full-policy still requires every routing field and proof.

The supplied provider payout sample has top-level `pvb_accrued_interest_wallet`
and `eventData.destination_wallet` in different apparent namespaces; its
destination UUID is **not** the candidate FAAS identifier and belongs to another
wallet. It proves no exact destination/customer binding for this test goal.
A genuine payout is **not** required to approve a policy: independently documented
field mapping plus exact provider-controlled identity readback can suffice.
Without that mapping, full-policy refuses; goal-only installs no policy. The
interest receipt bridge later credits the
full customer net only after a genuine eligible paid receipt. The 814/81/733
sample is not passed into this executable or injected into staging.

## Parent-only execution

Canonical source is `/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/interest-bridge/test-plan`.
Parent audit directory is `/root/baci-financial-owner.2ynkl9kc`. The local
parent-collected metadata file `/private/tmp/baci-empty-plan-live-inputs-20261002.json`
has SHA-256 `847646f609c14488cd60c430f1825b096767f18b6f7a67d45be6d0de67298930`.
The parent supplied candidate GET artifact pin is
`e63c3823c8e5c38ba65ccab0f4d490f5ad4dfb7b4877dc37e06c30913bce3d8d`;
this agent verified only the local metadata file's bytes, not that root-private
GET. Neither preliminary file replaces a fresh inventory or execution GET.
The reported candidate has null `interest_payout_wallet`; its company parent
`01M238A0V75387H4HZ15YFWGX3` is not a documented customer payout destination.
Wallet metadata rate fields of zero do not prove a zero business global rate.

Keep the source directory separate from audit outputs. Stage these NEW files
root-private with root ownership and 0600 mode, preserving their bytes. Use the
published manifest SHA as `SOURCE_SHA`; do not rebuild or reinstall parent work.
The existing helper and credentials remain untouched. The container psql command
is the already verified `/nix/var/nix/profiles/default/bin/psql`, not a guessed
distribution path. No shared browser or root command is run by this agent.

First optional read-only metadata query, already executed successfully by parent:

```sh
docker exec -i baci-isolated-savings-db-1 /nix/var/nix/profiles/default/bin/psql \
  -U postgres -d postgres -X -Atq -v ON_ERROR_STOP=1 \
  < "$SOURCE_DIR/required-live-inputs.sql" > "$AUDIT_DIR/live-inputs.json"
```

Collect a reviewed protected-state inventory immediately before approval:

```sh
python3 -B "$SOURCE_DIR/empty_plan_owner.py" inventory \
  --source-manifest-sha256 "$SOURCE_SHA" --output "$AUDIT_DIR/inventory.json"
```

Inventory creates transaction-local temporary helper objects, sets the business
read transaction read-only, and rolls everything back. No permanent schema/data
changes are made. Its stdout contains only status and the root-private output
SHA. Keep `SNAPSHOT_SHA`, `APPROVAL_SHA`, and `REHEARSAL_SHA` from exact artifact
bytes. The identity input must retain SHA
`8d0a4f90a2f96182776baf91148b3bd3b27a3323eaff8d37362e24511b52d327`
from `/root/baci-interest-identity.5Qxbj342`; its September 27 historical
observation is never refreshed or represented as original HMAC verification.

Inventory psql stdout and the final inventory JSON artifact are each capped at
8 MiB of UTF-8 bytes. Reports are serialized compactly, including the terminating
newline, and checked after adding owner metadata; pretty-print inflation cannot
produce an unreadable oversized snapshot. Only the dedicated `--snapshot` reader
allows sealed files up to 8 MiB. Source files, source manifest, provider responses,
approval, identity, routing/eligibility/split proofs, rehearsal receipts, other
SQL outputs and non-inventory reports remain capped at 1 MiB. Ownership, 0600,
single-link, digest, freshness, schema/state, consent and financial guards are
unchanged. Refused oversized output is not a completed inventory artifact.

```sh
python3 -B "$SOURCE_DIR/empty_plan_owner.py" goal-rehearse \
  --source-manifest-sha256 "$SOURCE_SHA" \
  --approval "$AUDIT_DIR/approval.json" --approval-sha256 "$APPROVAL_SHA" \
  --snapshot "$AUDIT_DIR/inventory.json" --snapshot-sha256 "$SNAPSHOT_SHA" \
  --identity "$IDENTITY_FILE" \
  --eligibility-proof "$ELIGIBILITY_PROOF" --split-proof "$SPLIT_PROOF" \
  --output "$AUDIT_DIR/rehearsal.json"
```

Review the actual scoped opt-in, eligibility and global split artifacts; complete
the goal-only template with their pins and fresh inventory fields. Set
`AUDIT_DIR=/root/baci-financial-owner.2ynkl9kc`, `SOURCE_DIR` to the new sealed
source copy, and `SOURCE_SHA` to the delivered `SOURCE-SHA256SUMS` digest. Set
`IDENTITY_FILE`, `ELIGIBILITY_PROOF`, and `SPLIT_PROOF` to the existing reviewed
root-private evidence paths. Obtain `APPROVAL_SHA` and `SNAPSHOT_SHA` with
`sha256sum` over those exact files. Do not generate consent or provider proof
from this document or the synthetic test fixture.

After inspecting the rolled-back result, obtain `REHEARSAL_SHA` from its exact
bytes and run this within 120 seconds, using a previously nonexistent output:

```sh
python3 -B "$SOURCE_DIR/empty_plan_owner.py" goal-apply \
  --source-manifest-sha256 "$SOURCE_SHA" \
  --approval "$AUDIT_DIR/approval.json" --approval-sha256 "$APPROVAL_SHA" \
  --snapshot "$AUDIT_DIR/inventory.json" --snapshot-sha256 "$SNAPSHOT_SHA" \
  --identity "$IDENTITY_FILE" \
  --eligibility-proof "$ELIGIBILITY_PROOF" --split-proof "$SPLIT_PROOF" \
  --rehearsal "$AUDIT_DIR/rehearsal.json" --rehearsal-sha256 "$REHEARSAL_SHA" \
  --output "$AUDIT_DIR/commit.json"
```

For a future independently reviewed full-policy definition, use `rehearse` and
`apply` with the full template and `--routing-proof "$ROUTING_PROOF"`. Mode-specific
rehearsal pins cannot be exchanged. Changing routing changes the immutable
definition hash; this bundle does not upgrade a goal-only goal to a policy.
Apply repeats fresh provider GETs and schema/state checks. The persisted goal ID
comes from the commit, not the discarded rehearsal UUID. All protected rows,
including old principal 10000, treasury 10000/0/0, credentials' metadata, other
bindings, outboxes, operations and allocations remain unchanged. The original
treasury row must remain 10000/0/0, and aggregate treasury totals must also be
10000/0/0. Cumulative opening identities plus all replenishments must total
exactly 10000 under the same table locks, and each binding counter must reconcile
to its opening plus replenishments. The exact company business/source/worker
identity is checked. Inventory reports actual `companyBudgetKobo` and
`aggregateTreasuryBudgetKobo`; both must be 10000. The new goal does not authorize
another 10000. Snapshot hashes
exclude only this exact candidate's authorized rows. No provider POST/PATCH is
implemented. Public checkout remains intentionally read-only.

Ambiguous apply/transport failure reports `apply_unconfirmed`, never false success
or assumed rollback. Independently read back before retrying the same key. Exact
retries return one goal and binding, with no policy in goal-only; changed goal, ownership, metadata, source,
destination, eligibility or policy reference refuses without overwriting an
immutable mapping. Inventory-only refresh preserves the definition hash;
provider contract/consent changes do not.

The validated candidate's complete goal row, audit events and idempotency rows
are captured before binding inserts. After binding triggers and all deferred
constraints execute, those rows must remain exactly unchanged. A separate
read-only check revalidates the exact public-wallet/customer identity, enabled
restricted binding and policy absence. It does not recreate missing bindings or
invoke the creation RPC again. Both new and old principal values in receipts
come from actual final goal rows. The excluded candidate rows therefore have
an independent final proof, including their genuine consent fields.

This review revision supersedes the previous seal. Restage the complete source
directory and use the new manifest digest. Collect a fresh inventory and repeat
approval pinning and rehearsal; old-source rehearsal receipts cannot authorize
this revision. Local validation is not evidence of root r8 runtime activation.

## Local validation

Focused tests load the existing table, mapping, ledger guards, current 23-argument
creation RPC and policy table/guard contracts into an owned disposable PostgreSQL
17 instance. Each test restores an owned template database without disabling
business guards. Unix socket only, 1-MiB WAL segments, 4-MiB shared buffers,
automatic stop and deletion of only this fixture's temporary directory. No
provider or staging writes occur. Tests also cover root artifact pins, redacted
CLI refusal, stale evidence, exact aliases, concurrency, role/schema/row drift,
catalogue variants, conflicts and financial-side-effect rollback. No global build,
install is needed for this focused suite. Its synthetic unused bridge functions
test privilege boundaries only, not real receipt application or provider payout.
The creation RPC fixture currently reads the exact existing migration from
`/Users/mac/.codex/worktrees/0d77/Baci-app/supabase/migrations/20260923150000_customer_savings_goal_idempotency.sql`;
this dependency is read-only and is not part of the deployable runtime.

Run the colocated `*.test.py` files with importlib/unittest (Python discovery
ignores dotted test module names): the exact command is in `run-tests.sh`.
