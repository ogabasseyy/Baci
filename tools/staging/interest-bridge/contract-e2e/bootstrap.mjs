import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT_E2E } from './constants.mjs';
import { rebindDisposableRuntimeStorage } from './runtime-rebind.mjs';

export function bootstrapContractDatabase(database, loader, payout) {
  const scope = CONTRACT_E2E;
  database.sql(
    loader
      .track(fileURLToPath(new URL('fixture.sql', import.meta.url)))
      .toString('utf8')
  );
  const systemId = database.sql(
    'SELECT system_identifier FROM pg_control_system()'
  );
  for (const name of [
    'ingest-storage.sql',
    'replay-storage.sql',
    'replay-runtime-storage.sql',
    'receipt-signature-storage.sql',
  ]) {
    let sql = loader
      .track(
        resolve(scope.receiverRoot, 'apps/web/tools/piggyvest-staging', name)
      )
      .toString('utf8');
    if (name === 'replay-runtime-storage.sql')
      sql = rebindDisposableRuntimeStorage(sql, systemId);
    database.sql(sql, 'supabase_admin', {
      expected_system_identifier: systemId,
    });
  }
  for (const name of [
    '20260912120000_piggyvest_savings_ledger_tables.sql',
    '20260912120100_piggyvest_savings_ledger_guards.sql',
    '20260912120200_piggyvest_savings_ledger_apply.sql',
    '20260912120300_piggyvest_savings_ledger_snapshot.sql',
    '20260912120400_piggyvest_savings_ledger_registry_gate.sql',
    '20260912120500_piggyvest_savings_ledger_numeric_reference_casts.sql',
    '20260912080200_piggyvest_staging_wallet_goal_mappings.sql',
    '20260925130050_customer_savings_engagement_storage.sql',
    '20260925130100_customer_savings_engagement_events.sql',
    '20260926170000_piggyvest_interest_bridge.sql',
    '20261001140001_piggyvest_interest_existing_authority.sql',
    '20261001230001_customer_savings_interest_policy.sql',
    '20260930120000_piggyvest_interest_accrual_observations.sql',
    '20260930120100_customer_interest_accrual_observation_read.sql',
  ])
    database.sql(
      loader
        .track(resolve(scope.canonicalRoot, 'supabase/migrations', name))
        .toString('utf8')
    );
  database.sql(`
    GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO prefunded_treasury_operator;
    INSERT INTO piggyvest_savings_ledger.bindings VALUES
      ('${scope.goalId}', '${scope.integrationId}', '${scope.merchantId}', '${scope.customerId}',
       'prefunded_treasury_operator', true);
    GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb) TO prefunded_treasury_operator;
    SET SESSION AUTHORIZATION prefunded_treasury_operator;
    SELECT piggyvest_savings_ledger.apply('${scope.integrationId}', '${scope.merchantId}',
      '${scope.customerId}', '${scope.goalId}',
      '{"operationId":"60000000-0000-4000-8000-000000000001","kind":"credit_principal", "principalKobo":10000,"interestKobo":0,"evidenceId":"synthetic-opening-only","referenceId":null}');
    RESET SESSION AUTHORIZATION;
    REVOKE EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb) FROM prefunded_treasury_operator;
    GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text) TO prefunded_treasury_operator;
  `);
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  database.sql(`
    INSERT INTO piggyvest_staging.wallet_goal_mappings VALUES
      ('${scope.integrationId}', ${quote(payout.pvb_wallet)}, ${quote(payout.customer_id)},
       '${scope.merchantId}', '${scope.customerId}', '${scope.goalId}');
    INSERT INTO piggyvest_savings_ledger.interest_policies
      (integration_id,provider_business_id,provider_customer_id,interest_source_wallet_id,
       payout_wallet_id,merchant_id,customer_id,goal_id,interest_enabled,
       eligibility_evidence,policy_reference,expires_at,enabled)
    VALUES ('${scope.integrationId}', '${scope.businessId}', ${quote(payout.customer_id)},
      ${quote(payout.pvb_accrued_interest_wallet)}, ${quote(payout.eventData.destination_wallet)},
      '${scope.merchantId}', '${scope.customerId}', '${scope.goalId}', true,
      'synthetic-fixture-not-provider-eligibility', 'synthetic-full-net-policy',
      clock_timestamp() + interval '1 hour', true);
  `);
  database.sql(
    loader
      .track(fileURLToPath(new URL('fixture.test.sql', import.meta.url)))
      .toString('utf8')
  );
  return {
    integrationId: scope.integrationId,
    businessId: scope.businessId,
    expectedSystemId: systemId,
  };
}
