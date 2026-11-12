// The only SQL the wallet pay flow may send. Executors allow-list these exact
// strings, so a caller can never run anything else through them.

/** Authorizer login, first parameter = the verified customer scope. */
export const WALLET_PAY_CUSTOMER_STATEMENTS = {
  issue:
    'SELECT piggyvest_primary.issue_wallet_payment($1::jsonb,$2::jsonb) AS result',
  readIssued:
    'SELECT piggyvest_primary.read_issued_wallet_payment($1::jsonb,$2::uuid) AS result',
  reserve:
    'SELECT piggyvest_primary.reserve_wallet_payment_with_pin($1::jsonb,$2::jsonb,$3::text) AS result',
  manage:
    'SELECT piggyvest_primary.manage_wallet_payment($1::jsonb,$2::uuid,$3::text) AS result',
  status:
    'SELECT piggyvest_primary.read_wallet_payment_status($1::jsonb,$2::uuid) AS result',
} as const;

/** Authorizer login, first parameters = integration id and environment. */
export const WALLET_PAY_WORKER_STATEMENTS = {
  claim:
    'SELECT piggyvest_primary.claim_wallet_payment_fulfilment($1::uuid,$2::text,$3::uuid) AS result',
  finish:
    'SELECT piggyvest_primary.finish_wallet_payment_fulfilment($1::uuid,$2::text,$3::uuid,$4::text,$5::uuid) AS result',
  readOwedRefund:
    'SELECT piggyvest_primary.read_owed_wallet_refund($1::uuid,$2::text,$3::uuid) AS result',
  manageRefund:
    'SELECT piggyvest_primary.manage_wallet_refund($1::uuid,$2::text,$3::uuid,$4::text) AS result',
  work: 'SELECT piggyvest_primary.list_wallet_pay_work($1::uuid,$2::text,$3::integer) AS result',
  releaseStale:
    'SELECT piggyvest_primary.release_stale_wallet_payment($1::uuid,$2::text,$3::uuid) AS result',
} as const;

/** Evidence login, (integration id, environment, one value). */
export const WALLET_PAY_EVIDENCE_STATEMENTS = {
  readDispatchedPayment:
    'SELECT piggyvest_primary.read_dispatched_wallet_payment($1::uuid,$2::text,$3::uuid) AS result',
  readDispatchedRefund:
    'SELECT piggyvest_primary.read_dispatched_wallet_refund($1::uuid,$2::text,$3::uuid) AS result',
  readRefundAttempt:
    'SELECT piggyvest_primary.read_wallet_refund_attempt($1::uuid,$2::text,$3::text) AS result',
  findByReference:
    'SELECT piggyvest_primary.find_wallet_pay_transfer_by_reference($1::uuid,$2::text,$3::text) AS result',
  settlePayment:
    'SELECT piggyvest_primary.settle_wallet_payment($1::uuid,$2::text,$3::jsonb) AS result',
  releasePayment:
    'SELECT piggyvest_primary.release_failed_wallet_payment($1::uuid,$2::text,$3::jsonb) AS result',
  settleRefund:
    'SELECT piggyvest_primary.settle_wallet_refund($1::uuid,$2::text,$3::jsonb) AS result',
  releaseRefund:
    'SELECT piggyvest_primary.release_failed_wallet_refund($1::uuid,$2::text,$3::jsonb) AS result',
  reconciliation:
    'SELECT piggyvest_primary.read_wallet_pay_reconciliation($1::uuid,$2::text,$3::jsonb) AS result',
} as const;
