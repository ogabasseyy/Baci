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

-- 3d2. A delegable grant (WITH ADMIN OPTION) lets the login hand the role on.
SAVEPOINT login_evidence_admin;
GRANT piggyvest_primary_evidence TO pv_er_exec WITH ADMIN OPTION;
SELECT pg_temp.check(pg_temp.gaps('inflow', 'pv_er_exec') = 'login_membership_unsafe',
  'an evidence grant WITH ADMIN OPTION on the login must be reported alone');
ROLLBACK TO SAVEPOINT login_evidence_admin;

SAVEPOINT evidence_reader_admin;
GRANT piggyvest_primary_readiness_reader TO piggyvest_primary_evidence WITH ADMIN OPTION;
SELECT pg_temp.check(pg_temp.gaps('inflow', 'pv_er_exec') = 'login_membership_unsafe',
  'a delegable readiness reader grant along the chain must be reported alone');
ROLLBACK TO SAVEPOINT evidence_reader_admin;

-- 3e. The unmodified privilege scan (pg_temp.real_gaps never filters). The
-- worker is ready exactly when no violation row exists at all, and otherwise
-- fails closed with bank_role_unsafe, so PUBLIC noise is never trusted here.
SELECT pg_temp.check(pg_temp.real_gaps('bank_inbox', 'baci_primary_bank_worker') =
  CASE WHEN EXISTS (SELECT 1 FROM piggyvest_primary.bank_role_violations(
      'baci_primary_bank_worker', true))
    THEN 'bank_role_unsafe' ELSE '' END,
  'the unmodified scan must make the worker ready, or fail closed on any violation');

-- An extra non-baseline privilege is always reported by the unmodified check
-- and is never hidden by the baseline filter.
SAVEPOINT real_bank_extra_relation;
GRANT SELECT ON piggyvest_primary.integrations TO baci_primary_bank_worker;
SELECT pg_temp.check(pg_temp.real_gaps('bank_inbox', 'baci_primary_bank_worker') = 'bank_role_unsafe',
  'the unmodified scan must report an extra relation privilege');
SELECT pg_temp.check(pg_temp.gaps('bank_inbox', 'baci_primary_bank_worker') = 'bank_role_unsafe',
  'the baseline filter must not hide an extra relation privilege');
ROLLBACK TO SAVEPOINT real_bank_extra_relation;

SAVEPOINT real_bank_extra_member;
CREATE ROLE pv_er_real_extra NOLOGIN;
GRANT pv_er_real_extra TO primary_bank_inbox_worker;
SELECT pg_temp.check(pg_temp.real_gaps('bank_inbox', 'baci_primary_bank_worker') = 'bank_role_unsafe',
  'the unmodified scan must report an extra bank capability membership');
ROLLBACK TO SAVEPOINT real_bank_extra_member;

-- 3f. A non-owner reads the same verdict through engine_ready: the reader
-- grant is inherited, no SET-able owner is needed, and the answer is that of
-- the session login.
SELECT piggyvest_primary.engine_ready('inflow') AS owner_inflow \gset
SELECT piggyvest_primary.engine_ready('bank_inbox') AS owner_bank \gset
-- The suite session may not be allowed to SET ROLE to roles it created.
GRANT pv_er_exec, baci_primary_bank_worker TO CURRENT_USER;
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
