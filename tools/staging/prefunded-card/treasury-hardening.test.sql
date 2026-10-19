BEGIN;

SELECT prefunded_treasury_test.assert(
  to_regprocedure('prefunded_card.credit_route_dispatch_ready(uuid)') IS NULL,
  'standalone treasury tests start without the projection admission function'
);

SET SESSION AUTHORIZATION prefunded_worker;
SELECT prefunded_treasury_test.expect_denied(
  $$SELECT prefunded_card.claim_collection('70000000-0000-4000-8000-000000000001', 0)$$,
  'treasury budget alone cannot authorize dispatch without the projection bundle'
);
RESET SESSION AUTHORIZATION;
ROLLBACK;

CREATE FUNCTION prefunded_card.credit_route_dispatch_ready(operation_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT operation_id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION prefunded_card.credit_route_dispatch_ready(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

BEGIN;

SET SESSION AUTHORIZATION prefunded_treasury_verifier;
SELECT prefunded_card.record_treasury_snapshot(
  '50000000-0000-4000-8000-000000000001', 'dispatch-drift', 4,
  clock_timestamp(), 70000
);
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION prefunded_worker;
SELECT prefunded_treasury_test.expect_denied(
  $$SELECT prefunded_card.claim_collection('70000000-0000-4000-8000-000000000001', 0)$$,
  'post-reservation drift blocks the first provider dispatch'
);
RESET SESSION AUTHORIZATION;
ROLLBACK;

BEGIN;
SET SESSION AUTHORIZATION prefunded_treasury_verifier;
SELECT prefunded_treasury_test.expect_denied(
  $$SELECT prefunded_card.record_treasury_snapshot(
    '50000000-0000-4000-8000-000000000001', 'stale-snapshot', 4,
    clock_timestamp() - interval '16 minutes', 60000
  )$$,
  'stale snapshot evidence is rejected before it can influence the float'
);
SELECT prefunded_treasury_test.expect_denied(
  $$SELECT prefunded_card.record_treasury_snapshot(
    '50000000-0000-4000-8000-000000000001', 'oversized-snapshot',
    9007199254740992, clock_timestamp(), 60000
  )$$,
  'snapshot sequence is capped at the safe integer boundary'
);
RESET SESSION AUTHORIZATION;

INSERT INTO prefunded_card.treasury_snapshots (
  treasury_binding_id, evidence_id, sequence_number, observed_at, available_kobo, verified_by
) VALUES (
  '50000000-0000-4000-8000-000000000001', 'approval-stale', 4,
  clock_timestamp() - interval '16 minutes', 70000, 'prefunded_treasury_verifier'
);
SET SESSION AUTHORIZATION prefunded_treasury_provisioner;
SELECT prefunded_treasury_test.expect_denied(
  $$SELECT prefunded_card.approve_treasury_replenishment(
    '80000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000001',
    'approval-stale', 'settlement-stale', 10000
  )$$,
  'stale snapshot cannot approve a replenishment'
);
RESET SESSION AUTHORIZATION;
ROLLBACK;

BEGIN;
SET SESSION AUTHORIZATION prefunded_treasury_provisioner;
SELECT prefunded_card.provision_treasury_identity(
  '50000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'expected-business', 'source-wallet-2', 'prefunded_worker', 5000
);
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION prefunded_treasury_verifier;
SELECT prefunded_card.record_treasury_snapshot(
  '50000000-0000-4000-8000-000000000002', 'second-binding-snapshot', 1,
  clock_timestamp(), 5000
);
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION prefunded_treasury_provisioner;
SELECT prefunded_treasury_test.expect_denied(
  $$SELECT prefunded_card.approve_treasury_replenishment(
    '80000000-0000-4000-8000-000000000003',
    '50000000-0000-4000-8000-000000000002',
    'snapshot-0003', 'cross-binding-settlement', 10000
  )$$,
  'a snapshot cannot replenish a different source binding'
);
RESET SESSION AUTHORIZATION;
ROLLBACK;

BEGIN;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA prefunded_card TO prefunded_treasury_provisioner;
SET SESSION AUTHORIZATION prefunded_treasury_provisioner;
SELECT prefunded_card.suspend_treasury_binding(
  '50000000-0000-4000-8000-000000000001'
);
RESET SESSION AUTHORIZATION;
SELECT prefunded_treasury_test.assert(
  (SELECT NOT enabled FROM prefunded_card.treasury_bindings
    WHERE id = '50000000-0000-4000-8000-000000000001'),
  'provisioner can suspend without changing the frozen identity'
);
SELECT prefunded_treasury_test.expect_denied(
  $$UPDATE prefunded_card.treasury_bindings SET enabled = true
    WHERE id = '50000000-0000-4000-8000-000000000001'$$,
  'suspended binding cannot be reenabled through a table update'
);
SELECT prefunded_treasury_test.expect_denied(
  $$TRUNCATE prefunded_card.treasury_bindings CASCADE$$,
  'treasury binding cannot be truncated even by an accidentally granted role'
);
SELECT prefunded_treasury_test.expect_denied(
  $$TRUNCATE prefunded_card.treasury_snapshots CASCADE$$,
  'treasury snapshots cannot be truncated even by an accidentally granted role'
);
SELECT prefunded_treasury_test.expect_denied(
  $$TRUNCATE prefunded_card.treasury_replenishments$$,
  'treasury replenishments cannot be truncated even by an accidentally granted role'
);
ROLLBACK;
