/**
 * Normalised statement fragments (see normalizeSql / shapeAround) that decide
 * WHICH ledger rows reach each balance CASE and how they are aggregated, plus
 * the statements that enforce the safety gates. The drift test requires every
 * fragment verbatim, so a new join, filter, FILTER clause or aggregate fails.
 */
export const AGGREGATE_SHAPES = {
  app: [
    'WITH customer_rollup AS (SELECT cw.id AS wallet_id, COALESCE(SUM(<CASE>), 0) AS available_balance,',
    'FROM public.customer_wallets cw LEFT JOIN public.customer_wallet_transactions cwt ON cwt.wallet_id = cw.id GROUP BY cw.id)',
  ],
  list: [
    'WITH positive AS (SELECT id FROM public.customer_wallets WHERE available_balance > 0), ledger AS (SELECT cwt.wallet_id, COALESCE(SUM(<CASE>), 0) AS ledger_balance,',
    "count(*) FILTER (WHERE cwt.status = 'pending') AS pending_count, bool_or(cwt.source_type = 'piggyvest_legacy_migration') AS migrated FROM public.customer_wallet_transactions cwt JOIN positive p ON p.id = cwt.wallet_id GROUP BY cwt.wallet_id)",
  ],
  zero: [
    'SELECT count(*) INTO v_bad FROM legacy_zero_out_list l WHERE l.expected_balance IS DISTINCT FROM (SELECT COALESCE(SUM(<CASE>), 0) FROM public.customer_wallet_transactions t WHERE t.wallet_id = l.wallet_id); IF v_bad <> 0 THEN RAISE EXCEPTION',
  ],
} as const;

/** Gate statements: the check, its count and the raise or commit decision together. */
export const GATE_SHAPES = {
  list: [
    '(cw.available_balance IS NOT DISTINCT FROM COALESCE(l.ledger_balance, 0) AND COALESCE(l.pending_count, 0) = 0 AND NOT COALESCE(l.migrated, false) AND c.id IS NOT NULL AND cw.available_balance <= 99999999.99) AS eligible',
    'FROM public.customer_wallets cw LEFT JOIN public.customers c ON c.id = cw.customer_id AND c.merchant_id = cw.merchant_id',
    '(c.id IS NOT NULL) AS customer_found',
  ],
  zero: [
    "v_mode := current_setting('baci.zero_out_mode', true); IF v_mode IS NULL OR v_mode NOT IN ('dry_run', 'commit') THEN RAISE EXCEPTION",
    "IF v_mode = 'commit' AND EXISTS (",
    'SELECT count(*) INTO v_bad FROM legacy_zero_out_list l WHERE NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = l.customer_id AND c.merchant_id = l.merchant_id); IF v_bad <> 0 THEN RAISE EXCEPTION',
    "SELECT (:'zero_out_mode' = 'commit') AS do_commit \\gset \\if :do_commit COMMIT; \\else ROLLBACK; \\endif",
    "SELECT set_config('baci.zero_out_mode', :'zero_out_mode', true);",
  ],
} as const;
