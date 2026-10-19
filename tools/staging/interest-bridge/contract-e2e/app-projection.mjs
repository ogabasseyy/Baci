import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { CONTRACT_E2E } from './constants.mjs';

export function readAppProjection(database, loader) {
  const scope = CONTRACT_E2E;
  const mobile = (name) =>
    loader.load(resolve(scope.canonicalRoot, 'apps/mobile-storefront', name));
  const authenticated = (query) =>
    JSON.parse(
      database.sql(`
    BEGIN; SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claim.sub='${scope.userId}';
    ${query}; ROLLBACK;
  `)
    );
  const earnings = mobile(
    'schemas/wallet-savings-interest.ts'
  ).WalletSavingsInterestResponseSchema.parse(
    authenticated(
      `SELECT public.get_customer_savings_earnings('${scope.merchantId}',true)`
    )
  );
  const inbox = mobile(
    'schemas/savings-notifications.ts'
  ).SavingsNotificationInboxResponseSchema.parse(
    authenticated(
      `SELECT public.get_customer_savings_notifications('${scope.merchantId}')`
    )
  );
  const accruals = authenticated(
    `SELECT public.get_customer_savings_interest_accrual_observations('${scope.merchantId}')`
  );
  const goals = JSON.parse(
    database.sql(`SELECT json_agg(row) FROM (
    SELECT id,status,current_amount FROM public.customer_savings_goals
    WHERE id='${scope.goalId}'
  ) row`)
  );
  const projected = mobile(
    'hooks/wallet-savings-interest-projection.ts'
  ).projectWalletSavingsInterest({
    goals,
    goalInterestKobo: earnings.goal_interest_kobo,
  });
  assert.equal(goals[0].current_amount, 100);
  assert.equal(projected.appliedInterestKobo, earnings.credited_interest_kobo);
  return { earnings, inbox, accruals, projected };
}
