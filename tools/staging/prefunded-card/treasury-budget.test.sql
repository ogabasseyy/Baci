SET SESSION AUTHORIZATION prefunded_worker;
SELECT prefunded_treasury_test.assert(
  (prefunded_card.claim_collection('70000000-0000-4000-8000-000000000001', 0)->>'outcome') = 'claimed',
  'reserved operation collection is claimed once'
);
SELECT prefunded_treasury_test.assert(
  prefunded_card.record_collection(
    '70000000-0000-4000-8000-000000000001', 1, 'verified_success',
    jsonb_build_object(
      'reference', 'collection-1', 'amountKobo', 10000, 'currency', 'NGN',
      'savedMethodId', '60000000-0000-4000-8000-000000000001',
      'providerTransactionId', 'charge-1'
    )
  ) = 'verified_success',
  'verified collection preserves the company reservation'
);
SELECT prefunded_treasury_test.assert(
  (prefunded_card.claim_transfer('70000000-0000-4000-8000-000000000001', 0)->>'outcome') = 'claimed',
  'verified collection unlocks its fixed transfer request'
);
SELECT prefunded_treasury_test.assert(
  prefunded_card.record_transfer(
    '70000000-0000-4000-8000-000000000001', 1, 'verified_success',
    jsonb_build_object(
      'reference', 'transfer-1', 'businessId', 'expected-business',
      'sourceWalletId', 'source-wallet', 'destinationWalletId', 'destination-wallet',
      'destinationCustomerId', 'destination-customer', 'amountKobo', 10000,
      'currency', 'NGN', 'providerTransactionId', 'transfer-1'
    )
  ) = 'verified_success',
  'verified transfer consumes the treasury exactly once'
);
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION prefunded_treasury_verifier;
SELECT prefunded_card.record_treasury_snapshot(
  '50000000-0000-4000-8000-000000000001', 'snapshot-0006', 6,
  clock_timestamp(), 50000
);
RESET SESSION AUTHORIZATION;

SELECT prefunded_treasury_test.assert(
  (SELECT consumed_kobo = 10000 AND reserved_kobo = 10000 AND verified_available_kobo = 60000
    FROM prefunded_card.treasury_bindings
    WHERE id = '50000000-0000-4000-8000-000000000001'),
  'consumed transfers remain in the cumulative float equation'
);
SELECT prefunded_treasury_test.assert(
  prefunded_card.treasury_reservation_ready('50000000-0000-4000-8000-000000000001'),
  'post-transfer snapshot reconciles only the consumed outflow'
);

SET SESSION AUTHORIZATION prefunded_worker;
SELECT prefunded_treasury_test.assert(
  prefunded_card.reserve(prefunded_treasury_test.command(3))->>'outcome' = 'reserved',
  'remaining budget reserves after consumption'
);
SELECT prefunded_treasury_test.assert(
  prefunded_card.reserve(prefunded_treasury_test.command(4))->>'outcome' = 'reserved',
  'second remaining reservation serializes'
);
SELECT prefunded_treasury_test.assert(
  prefunded_card.reserve(prefunded_treasury_test.command(5))->>'outcome' = 'reserved',
  'third remaining reservation serializes'
);
SELECT prefunded_treasury_test.assert(
  prefunded_card.reserve(prefunded_treasury_test.command(6))->>'outcome' = 'reserved',
  'fourth remaining reservation serializes'
);
SELECT prefunded_treasury_test.expect_denied(
  $$SELECT prefunded_card.reserve(prefunded_treasury_test.command(7))$$,
  'oversubscription cannot spend a later balance or consumed float twice'
);
RESET SESSION AUTHORIZATION;

SELECT prefunded_treasury_test.assert(
  (SELECT reserved_kobo = 50000 AND consumed_kobo = 10000
    FROM prefunded_card.treasury_bindings
    WHERE id = '50000000-0000-4000-8000-000000000001'),
  'oversubscription leaves the locked cumulative budget unchanged'
);
