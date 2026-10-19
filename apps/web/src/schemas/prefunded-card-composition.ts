import { z } from 'zod';
import { prefundedCardCompositionDatabase } from './prefunded-card-composition-database';
import { prefundedCardProviderSchemas } from './prefunded-card-provider';
import { prefundedCardProviderEvidenceSchemas } from './prefunded-card-provider-evidence';
import { prefundedCardWorkerSchemas } from './prefunded-card-worker';

const { profile: databaseFor, samePhysicalIdentity: sameDatabase } =
  prefundedCardCompositionDatabase;

export const prefundedCardCompositionSchema = z
  .strictObject({
    worker: prefundedCardWorkerSchemas.scope,
    provider: prefundedCardProviderSchemas.settings,
    evidence: prefundedCardProviderEvidenceSchemas.configuration,
    database: z.strictObject({
      treasury: databaseFor('worker'),
      ingestion: databaseFor('evidence'),
      authorizer: databaseFor('authorizer'),
    }),
  })
  .superRefine(({ worker, provider, evidence, database }, context) => {
    const providerSettings = provider.piggyvest;
    const evidenceSettings = evidence.piggyvest;
    if (
      !sameDatabase(database.treasury, database.ingestion) ||
      !sameDatabase(database.treasury, database.authorizer) ||
      worker.expectedSystemId !== database.treasury.expectedSystemId ||
      worker.expectedSystemId !== evidence.systemIdentifier ||
      worker.integrationId !== provider.scope.integrationId ||
      worker.integrationId !== evidence.integrationId ||
      worker.merchantId !== provider.scope.merchantId ||
      worker.treasuryBindingId !== provider.scope.treasuryBindingId ||
      worker.businessId !== providerSettings.expectedBusinessId ||
      worker.businessId !== evidenceSettings.expectedBusinessId ||
      providerSettings.apiBaseUrl !== evidenceSettings.apiBaseUrl ||
      providerSettings.apiSecret !== evidenceSettings.apiSecret ||
      providerSettings.expectedCurrency !== evidenceSettings.expectedCurrency ||
      providerSettings.timeoutMs !== evidenceSettings.timeoutMs ||
      providerSettings.maxResponseBytes !== evidenceSettings.maxResponseBytes
    )
      context.addIssue({ code: 'custom', message: 'Invalid composition' });
  });
