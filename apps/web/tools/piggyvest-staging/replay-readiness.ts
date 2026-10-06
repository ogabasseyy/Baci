import { createAccrualObserverReplay } from './replay-accrual-observer-runtime';
import { readReplayConfiguration } from './replay-configuration';
import { checkFinancialReplayReadiness } from './replay-financial-readiness';
import { loadPrefundedReplay } from './replay-prefunded-loader';
import { createPrivateReplayFetch } from './replay-private-fetch';
import { parseReplayRuntimeConfig } from './schemas/replay-runtime-config';

export type ReplayReadinessStage =
  | 'configuration'
  | 'financial-database'
  | 'interest-authority'
  | 'accrual-observer'
  | 'prefunded-runtime'
  | 'receipt-database'
  | 'app-database';

export type ReplayReadinessResult =
  | { ready: true }
  | { ready: false; stage: ReplayReadinessStage };

interface Dependencies {
  read: typeof readReplayConfiguration;
  load: typeof loadPrefundedReplay;
  fetchImplementation: typeof fetch;
  financial?: typeof checkFinancialReplayReadiness;
  accrual?: typeof createAccrualObserverReplay;
}

const receiptIdentityUrl =
  'http://127.0.0.1:4792/rest/v1/rpc/piggyvest_staging_system_id';
const appIdentityUrl =
  'http://127.0.0.1:4793/rest/v1/rpc/piggyvest_staging_system_id';

async function hasExpectedIdentity(
  target: 'receipt' | 'app',
  url: string,
  token: string,
  expected: string,
  fetchImplementation: typeof fetch
): Promise<boolean> {
  try {
    const response = await createPrivateReplayFetch(
      target,
      fetchImplementation
    )(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    if (!response.ok) return false;
    const actual: unknown = await response.json();
    return typeof actual === 'string' && actual === expected;
  } catch {
    return false;
  }
}

export async function checkReplayReadiness(
  dependencies: Dependencies = {
    read: readReplayConfiguration,
    load: loadPrefundedReplay,
    fetchImplementation: fetch,
  }
): Promise<ReplayReadinessResult> {
  let configuration: ReturnType<typeof parseReplayRuntimeConfig>;
  try {
    configuration = parseReplayRuntimeConfig(await dependencies.read());
    const treasuryInterestOnly =
      configuration.financialDatabase?.role === 'prefunded_treasury_operator';
    if (!configuration.prefundedReplay && !treasuryInterestOnly)
      return { ready: false, stage: 'prefunded-runtime' };
  } catch {
    return { ready: false, stage: 'configuration' };
  }

  if (configuration.prefundedReplay) {
    try {
      await dependencies.load({
        activation: configuration.prefundedReplay,
        expectedAppSystemId: configuration.appSystemId,
        ...(configuration.paidInterestDatabase
          ? {
              paidInterestScope: {
                integrationId: configuration.paidInterestDatabase.integrationId,
                businessId: configuration.paidInterestDatabase.businessId,
                expectedSystemId: configuration.appSystemId,
              },
            }
          : {}),
      });
    } catch {
      return { ready: false, stage: 'prefunded-runtime' };
    }
  }

  if (configuration.accrualObserver) {
    try {
      await (dependencies.accrual ?? createAccrualObserverReplay)({
        observer: configuration.accrualObserver,
        activation: configuration.prefundedReplay,
        expectedAppSystemId: configuration.appSystemId,
      });
    } catch {
      return { ready: false, stage: 'accrual-observer' };
    }
  }
  const [receiptReady, appReady] = await Promise.all([
    hasExpectedIdentity(
      'receipt',
      receiptIdentityUrl,
      configuration.receiptToken,
      configuration.receiptSystemId,
      dependencies.fetchImplementation
    ),
    hasExpectedIdentity(
      'app',
      appIdentityUrl,
      configuration.appToken,
      configuration.appSystemId,
      dependencies.fetchImplementation
    ),
  ]);
  if (!receiptReady) return { ready: false, stage: 'receipt-database' };
  if (!appReady) return { ready: false, stage: 'app-database' };
  const interestDatabase =
    configuration.paidInterestDatabase ??
    (configuration.financialDatabase?.role === 'prefunded_treasury_operator'
      ? configuration.financialDatabase
      : undefined);
  if (interestDatabase) {
    try {
      const financial = await (
        dependencies.financial ?? checkFinancialReplayReadiness
      )(interestDatabase, configuration.appSystemId);
      if (financial === 'authority-unavailable')
        return { ready: false, stage: 'interest-authority' };
      if (financial !== 'ready')
        return { ready: false, stage: 'financial-database' };
    } catch {
      return { ready: false, stage: 'financial-database' };
    }
  }
  return { ready: true };
}
