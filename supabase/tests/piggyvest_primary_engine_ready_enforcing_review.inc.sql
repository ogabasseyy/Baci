-- Part of piggyvest_primary_engine_ready_enforcing.sql (\ir): review fences.
-- Runs inside the entry file's transaction; not a standalone suite.

-- 3c. The signed inbox the worker claims from is a bank_inbox fence.
SAVEPOINT bank_signed_inbox_gone;
ALTER TABLE piggyvest_primary.bank_signed_inbox RENAME TO bank_signed_inbox_gone;
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = 'ledger_objects_missing',
  'a missing signed inbox table must be reported alone for the bank inbox');
ROLLBACK TO SAVEPOINT bank_signed_inbox_gone;

-- 3d. Inherited memberships: a privileged role reached through the evidence
-- role or the readiness reader is as unsafe as one granted to the login.
SAVEPOINT evidence_inherits_extra;
CREATE ROLE pv_er_chain_a NOLOGIN;
GRANT pv_er_chain_a TO piggyvest_primary_evidence;
SELECT pg_temp.check(pg_temp.gaps('inflow', 'pv_er_exec') = 'login_membership_unsafe',
  'a role inherited through the evidence role must be reported alone');
ROLLBACK TO SAVEPOINT evidence_inherits_extra;

SAVEPOINT reader_inherits_extra;
CREATE ROLE pv_er_chain_b NOLOGIN;
GRANT pv_er_chain_b TO piggyvest_primary_readiness_reader;
SELECT pg_temp.check(pg_temp.gaps('inflow', 'pv_er_exec') = 'login_membership_unsafe',
  'a role inherited through the readiness reader must be reported alone');
ROLLBACK TO SAVEPOINT reader_inherits_extra;

-- 3e. The real privilege scan. The suite wrapper drops function and relation
-- rows a bare login also has (PUBLIC privileges of the image). Put the
-- unmodified scan back: the worker is ready exactly when the image has no such
-- shared rows, and otherwise fails closed with bank_role_unsafe.
SAVEPOINT real_bank_scan;
ALTER FUNCTION piggyvest_primary.bank_role_violations(name, boolean)
  RENAME TO bank_role_violations_wrapped;
ALTER FUNCTION piggyvest_primary.bank_role_violations_real(name, boolean)
  RENAME TO bank_role_violations;
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') =
  CASE WHEN EXISTS (SELECT 1 FROM piggyvest_primary.bank_role_violations('pv_er_bare', true) v
      WHERE v ~ '^(function|relation):')
    THEN 'bank_role_unsafe' ELSE '' END,
  'the unmodified scan must make the worker ready, or fail closed on shared privileges');
ROLLBACK TO SAVEPOINT real_bank_scan;

-- 3f. A non-owner reads the same verdict through engine_ready: the reader
-- grant is inherited, no SET-able owner is needed, and the answer is that of
-- the session login.
SELECT piggyvest_primary.engine_ready('inflow') AS owner_inflow \gset
SELECT piggyvest_primary.engine_ready('bank_inbox') AS owner_bank \gset
SET LOCAL ROLE pv_er_exec;
SELECT pg_temp.check(current_user = 'pv_er_exec'
    AND piggyvest_primary.engine_ready('inflow') = :'owner_inflow'::jsonb
    AND (piggyvest_primary.engine_ready('inflow')->>'ready')::boolean = false,
  'a non-owner executor must read the session verdict for inflow');
RESET ROLE;
SET LOCAL ROLE baci_primary_bank_worker;
SELECT pg_temp.check(current_user = 'baci_primary_bank_worker'
    AND piggyvest_primary.engine_ready('bank_inbox') = :'owner_bank'::jsonb,
  'a non-owner worker must read the session verdict for bank_inbox');
RESET ROLE;
