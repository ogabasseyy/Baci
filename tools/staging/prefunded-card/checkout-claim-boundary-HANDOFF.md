# First-card checkout / generic claim boundary

Source-only additive fix; nothing here is installed or remotely verified.

## Root cause and ownership

Every operation insert enqueues generic work. `claim_due` previously selected an unfinished first-card operation without consulting its checkout intent; the runtime then called `claim_reconciliation` for its pending collection. That routine incremented the verification fence and issued a collection lease without consulting the checkout intent either. Generic saved-card verification cannot finish first-card authorization enrollment.

The new migration excludes linked checkout intents unless both the phase is `funding_pending` or `completed` and `verified_collection` is non-null. The queue exclusion occurs before its limit, lease, token, and attempts update. The direct reconciliation exclusion occurs after the existing scoped operation lock but before any verification lease/fence update.

Promoted collections remain eligible for generic transfer dispatch, transfer verification, and projection under the existing guards. Ordinary saved-card operations are unchanged. No intent phase, reconciliation fence, lease, reserve, principal, payment reference, budget, routing, or interest rule is mutated by installation. Public refresh and checkout recovery candidate exclusions are unchanged: `reconciliation_required` still requires separate owner adjudication, not automatic checkout recovery.

## Additive installation requirements

Install `supabase/migrations/20261002160000_prefunded_first_card_claim_boundary.sql` separately from the old r8 artifact. Do not rewrite `dispatch-queue.sql`, `storage-functions.sql`, retirement patches, or installed seals. The migration changes only the two existing function bodies, preserving every other catalog field including OID, owner, ACL, security-definer status, arguments, and search path. Existing retirement and scope guards are retained.

1. Parent independently captures and reviews the actual physical database, role, current schema, both full installed definitions and SHA-256 hashes, catalog metadata, and financial baseline. Required read-only catalog evidence:

```sql
SELECT current_database() AS database_name, session_user AS login,
  (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier,
  p.oid, p.oid::regprocedure::text AS signature, p.proowner::regrole::text AS owner,
  (SELECT relowner::regrole::text FROM pg_class
    WHERE oid='prefunded_card.checkout_intents'::regclass) AS checkout_owner,
  (SELECT relforcerowsecurity FROM pg_class
    WHERE oid='prefunded_card.checkout_intents'::regclass) AS checkout_force_rls,
  p.proacl, p.proconfig, p.prosecdef, language.lanname,
  encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS body_sha256,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_language language ON language.oid=p.prolang
WHERE p.oid IN (
  'prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid)'::regprocedure,
  'prefunded_card.claim_reconciliation(uuid,integer)'::regprocedure);
```

2. Quiesce generic worker execution and wait for in-flight dispatch/verification calls to drain. Installation does not invalidate previously returned claims or erase existing leases; do not reset them. Confirm the target is the approved staging AppDB physical identifier `7685292944002592802`, not an alias or another database.
3. Use the existing routine owner in one `READ COMMITTED` transaction. Both routines must also own `checkout_intents`, with forced RLS disabled, so the exclusion cannot silently miss deny-policy-hidden rows. Set these transaction-local inputs from reviewed evidence, not from unreviewed automatic discovery:
   - `prefunded_card.claim_boundary_database`: exact current database name.
   - `prefunded_card.claim_boundary_system`: exact physical system identifier.
   - `prefunded_card.claim_boundary_claim_due_sha256`: approved predecessor `prosrc` SHA-256.
   - `prefunded_card.claim_boundary_claim_reconciliation_sha256`: approved predecessor `prosrc` SHA-256.
4. Rehearse by executing the migration and comparing both postflight definitions/catalog metadata and the financial baseline, then roll back. Apply the same reviewed transaction only after parent approval. The migration requires one exact replacement anchor per body, verifies predecessor hashes, and fails atomically on drift. Repeating with the same original predecessor pins is idempotent.
5. Verify no row or financial state changed, including old goal `430314fd-cd8b-4579-98d4-e9f345713dd6` opening principal, shared company cap/reserve, recovered intent `ff561046-58e7-428d-9163-f6e60b0dab65`, and new goal `9f01153c-1589-4dde-b9aa-8f644a846832`. Record the two new body hashes in a new additive installation artifact; the old r8 seals remain immutable. Parent owns source-closure/global checks and worker resumption.

The migration skips databases with no `prefunded_card` schema; this does not constitute installation. A present but incomplete or unreviewed schema fails closed. No live database name or predecessor hashes are fabricated here. TS-only deployment cannot fix this SQL claim boundary; no provider call or new payment is required to install it.

## Focused validation

```sh
PYTHONDONTWRITEBYTECODE=1 python3 supabase/migrations/20261002160000_prefunded_first_card_claim_boundary.test.py -v
```

The colocated test uses the existing PostgreSQL 18 Unix-socket scratch harness and real claim routines. Financial/ownership fixtures are isolated database clones, not live evidence. The original bug was reproduced before adding the migration: generic queue selection returned the unfinished checkout and direct reconciliation returned a collection verification lease instead of `not_verifiable`.
