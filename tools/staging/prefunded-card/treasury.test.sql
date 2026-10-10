CREATE FUNCTION prefunded_treasury_test.assert(value boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF value IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'assertion failed: %', label;
  END IF;
END $$;

CREATE FUNCTION prefunded_treasury_test.expect_denied(statement text, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
    RAISE EXCEPTION 'assertion failed: %', label;
  EXCEPTION WHEN insufficient_privilege OR invalid_parameter_value OR check_violation THEN
    NULL;
  END;
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA prefunded_treasury_test
  TO prefunded_worker, prefunded_treasury_provisioner, prefunded_treasury_verifier;

SET SESSION AUTHORIZATION prefunded_treasury_provisioner;
SELECT prefunded_card.provision_treasury_identity(
  '50000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'expected-business',
  'source-wallet',
  'prefunded_worker',
  50000
) AS provisioned;
RESET SESSION AUTHORIZATION;

SELECT prefunded_treasury_test.assert(
  (SELECT verified_available_kobo = 50000 AND reserved_kobo = 0 AND consumed_kobo = 0
    FROM prefunded_card.treasury_bindings
    WHERE id = '50000000-0000-4000-8000-000000000001'),
  'owner provisioned identity creates zero-fee opening float'
);

SET SESSION AUTHORIZATION prefunded_treasury_verifier;
SELECT prefunded_card.record_treasury_snapshot(
  '50000000-0000-4000-8000-000000000001',
  'snapshot-0001',
  1,
  clock_timestamp(),
  50000
) AS snapshot_result;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION prefunded_worker;
SELECT prefunded_treasury_test.assert(
  prefunded_card.reserve(prefunded_treasury_test.command(1))->>'outcome' = 'reserved',
  'fresh independently verified snapshot permits an in-budget reserve'
);
RESET SESSION AUTHORIZATION;

SELECT prefunded_treasury_test.assert(
  (SELECT reserved_kobo = 10000 FROM prefunded_card.treasury_bindings
    WHERE id = '50000000-0000-4000-8000-000000000001'),
  'reserve debits only the cumulative treasury budget'
);

SET SESSION AUTHORIZATION prefunded_treasury_verifier;
SELECT clock_timestamp() AS snapshot_two_at \gset
SELECT prefunded_card.record_treasury_snapshot(
  '50000000-0000-4000-8000-000000000001',
  'snapshot-0002',
  2,
  :'snapshot_two_at'::timestamptz,
  60000
);
RESET SESSION AUTHORIZATION;

SELECT prefunded_treasury_test.assert(
  prefunded_card.treasury_reservation_ready(
    '50000000-0000-4000-8000-000000000001'
  ) = false,
  'later balance alone cannot replenish a reserved treasury budget'
);

SET SESSION AUTHORIZATION prefunded_worker;
SELECT prefunded_treasury_test.expect_denied(
  $$SELECT prefunded_card.reserve(prefunded_treasury_test.command(2))$$,
  'unexplained balance drift blocks new spending'
);
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION prefunded_treasury_verifier;
SELECT prefunded_card.record_treasury_snapshot(
  '50000000-0000-4000-8000-000000000001',
  'snapshot-0002',
  2,
  :'snapshot_two_at'::timestamptz,
  60000
) AS replay_result;

SELECT prefunded_treasury_test.expect_denied(
  $$SELECT prefunded_card.record_treasury_snapshot(
    '50000000-0000-4000-8000-000000000001','snapshot-0002',2,clock_timestamp(),50001
  )$$,
  'conflicting snapshot identity is rejected'
);

SELECT prefunded_treasury_test.expect_denied(
  $$SELECT prefunded_card.record_treasury_snapshot(
    '50000000-0000-4000-8000-000000000001','snapshot-backward',1,clock_timestamp(),40000
  )$$,
  'backward snapshot sequence is rejected'
);

SELECT prefunded_treasury_test.expect_denied(
  $$SELECT prefunded_card.record_treasury_snapshot(
    '50000000-0000-4000-8000-000000000001','snapshot-future',3,
    clock_timestamp() + interval '2 minutes',40000
  )$$,
  'future snapshot evidence is rejected'
);
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION prefunded_treasury_verifier;
SELECT prefunded_card.record_treasury_snapshot(
  '50000000-0000-4000-8000-000000000001',
  'snapshot-0003',
  3,
  clock_timestamp(),
  60000
);
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION prefunded_treasury_provisioner;
SELECT prefunded_card.approve_treasury_replenishment(
  '80000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'snapshot-0003',
  'settlement-0001',
  10000
) AS replenished;
RESET SESSION AUTHORIZATION;

SELECT prefunded_treasury_test.assert(
  prefunded_card.treasury_reservation_ready(
    '50000000-0000-4000-8000-000000000001'
  ),
  'explicit verified replenishment reconciles a positive balance delta'
);

SET SESSION AUTHORIZATION prefunded_treasury_provisioner;
SELECT prefunded_treasury_test.expect_denied(
  $$SELECT prefunded_card.approve_treasury_replenishment(
    '80000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000001',
    'snapshot-0003','settlement-0002',10000
  )$$,
  'snapshot cannot replenish float twice'
);
RESET SESSION AUTHORIZATION;

BEGIN;
SET SESSION AUTHORIZATION prefunded_worker;
SELECT prefunded_treasury_test.expect_denied(
  $$UPDATE prefunded_card.treasury_bindings SET verified_available_kobo = 999999$$,
  'ledger worker cannot edit company float directly'
);
SELECT prefunded_treasury_test.expect_denied(
  $$SELECT prefunded_card.record_treasury_snapshot(
    '50000000-0000-4000-8000-000000000001','worker-snapshot',4,clock_timestamp(),60000
  )$$,
  'ledger worker cannot self-attest a snapshot'
);
RESET SESSION AUTHORIZATION;
ROLLBACK;

SELECT prefunded_treasury_test.expect_denied(
  $$UPDATE prefunded_card.treasury_identities SET source_wallet_id = 'other-wallet'$$,
  'identity source wallet is immutable'
);

SELECT prefunded_treasury_test.expect_denied(
  $$UPDATE prefunded_card.treasury_identities SET authorized_login = 'other-worker'$$,
  'identity worker boundary is immutable'
);
