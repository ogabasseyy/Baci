import { createAccrualObserverReplay } from './replay-accrual-observer-runtime';
import { createAccrualReplay } from './replay-accrual-runtime';
import { createFinancialReplayPostgres } from './replay-financial-postgres';
import { createInterestReplay } from './replay-interest-runtime';
import { createOutflowReplay } from './replay-outflow-runtime';
import { createPaidInterestReplay } from './replay-paid-interest-runtime';
import { loadPrefundedReplay } from './replay-prefunded-loader';
import { createPrivateReplayFetch } from './replay-private-fetch';
import { runReplayPass } from './replay-run';
import type { ReplayAdapters } from './replay-worker';
import { parseReplayRuntimeConfig } from './schemas/replay-runtime-config';
import { createDurableOutflowStore } from './transfer-outbox-finality';

export async function runConfiguredReplayPass(
  input: unknown,
  options: Pick<ReplayAdapters, 'prefundedReplay'> = {}
): Promise<void> {
  const config = parseReplayRuntimeConfig(input);
  let prefundedReplay = options.prefundedReplay;
  let paidInterestReplay: ReplayAdapters['dispatchFinancial'];
  if (config.paidInterestDatabase) {
    if (prefundedReplay || !config.prefundedReplay)
      throw new Error('Paired replay requires pinned runtime loading');
    prefundedReplay = await loadPrefundedReplay({
      activation: config.prefundedReplay,
      expectedAppSystemId: config.appSystemId,
      paidInterestScope: {
        integrationId: config.paidInterestDatabase.integrationId,
        businessId: config.paidInterestDatabase.businessId,
        expectedSystemId: config.appSystemId,
      },
    });
    paidInterestReplay = await createPaidInterestReplay({
      database: config.paidInterestDatabase,
      expectedAppSystemId: config.appSystemId,
    });
  }
  if (config.prefundedReplay && !prefundedReplay)
    throw new Error('Configured prefunded replay is unavailable');
  const observerReplay = config.accrualObserver
    ? await createAccrualObserverReplay({
        observer: config.accrualObserver,
        activation: config.prefundedReplay,
        expectedAppSystemId: config.appSystemId,
      })
    : undefined;
  const financial = config.financialDatabase;
  const treasuryInterestOnly =
    financial?.role === 'prefunded_treasury_operator';
  if (treasuryInterestOnly && options.prefundedReplay)
    throw new Error(
      'Prefunded bank replay is unavailable in paid-interest-only mode'
    );
  const execute = financial ? createFinancialReplayPostgres(financial) : null;
  const accrualReplay =
    observerReplay ??
    (financial &&
    execute &&
    config.interestAccrualSigningSecret &&
    !treasuryInterestOnly
      ? createAccrualReplay(
          {
            integrationId: financial.integrationId,
            businessId: financial.businessId,
            expectedSystemId: config.appSystemId,
          },
          config.interestAccrualSigningSecret,
          execute
        )
      : undefined);
  const dispatchInterest =
    financial && execute
      ? createInterestReplay(
          {
            integrationId: financial.integrationId,
            businessId: financial.businessId,
            expectedSystemId: config.appSystemId,
          },
          execute
        )
      : null;
  const dispatchOutflow =
    financial && execute && !treasuryInterestOnly
      ? createOutflowReplay(
          {
            integrationId: financial.integrationId,
            businessId: financial.businessId,
            expectedSystemId: config.appSystemId,
          },
          createDurableOutflowStore({
            integrationId: financial.integrationId,
            businessId: financial.businessId,
            expectedSystemId: config.appSystemId,
            execute,
          })
        )
      : null;
  const result = await runReplayPass({
    allowLegacyInflow: !treasuryInterestOnly,
    accrualReplay,
    prefundedReplay,
    dispatchFinancial:
      paidInterestReplay ??
      (dispatchInterest
        ? ({ event }) => {
            if (event.eventType === 'interest-payout.success')
              return dispatchInterest(event);
            if (!dispatchOutflow) throw new Error('Financial replay deferred');
            return dispatchOutflow(event);
          }
        : undefined),
    argv: ['--limit', '10', '--max-receipts', '10', '--lease-seconds', '300'],
    receiptFetch: createPrivateReplayFetch('receipt'),
    appFetch: createPrivateReplayFetch('app'),
    env: {
      NODE_ENV: 'development',
      PVB_STAGING_REPLAY_ENABLED: '1',
      PVB_STAGING_POSTGREST_URL: 'http://127.0.0.1:4792',
      PVB_STAGING_APP_URL: 'http://127.0.0.1:4793',
      PVB_STAGING_WORKER_JWT: config.receiptToken,
      PVB_STAGING_APP_KEY: config.appToken,
      PVB_STAGING_RECEIPT_KEY_B64: config.receiptKey,
      PVB_STAGING_EXPECTED_SYSTEM_ID: config.receiptSystemId,
      PVB_STAGING_EXPECTED_APP_SYSTEM_ID: config.appSystemId,
    },
  });
  if (result.resolutionFailures > 0) {
    throw new Error('Staging replay resolution failed');
  }
  if (result.retryable > 0) throw new Error('Staging replay deferred');
}
