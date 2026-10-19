import { z } from 'zod';
import { prefundedCardCompositionDatabase } from './prefunded-card-composition-database';
import { prefundedCardProviderEvidenceSchemas } from './prefunded-card-provider-evidence';
import { prefundedCardReplayEnrollmentSchemas } from './prefunded-card-replay-enrollment';

export const prefundedCardReplayRuntimeSchema = z
  .strictObject({
    configuration: z.strictObject({
      scope: prefundedCardReplayEnrollmentSchemas.configuration.shape.scope,
      evidence: prefundedCardProviderEvidenceSchemas.configuration,
      database: z.strictObject({
        treasury: prefundedCardCompositionDatabase.profile('worker'),
        ingestion: prefundedCardCompositionDatabase.profile('evidence'),
      }),
    }),
    expectedAppSystemId: z.string().regex(/^[0-9]{1,20}$/),
    fetchImplementation: z.custom<typeof fetch>(
      (value) => typeof value === 'function',
      'Invalid replay runtime'
    ),
  })
  .superRefine(({ configuration, expectedAppSystemId }, context) => {
    const { scope, evidence, database } = configuration;
    if (
      scope.expectedSystemId !== expectedAppSystemId ||
      database.treasury.expectedSystemId !== expectedAppSystemId ||
      database.ingestion.expectedSystemId !== expectedAppSystemId ||
      evidence.systemIdentifier !== expectedAppSystemId ||
      scope.integrationId !== evidence.integrationId ||
      scope.businessId !== evidence.piggyvest.expectedBusinessId ||
      evidence.piggyvest.expectedCurrency !== 'NGN' ||
      !prefundedCardCompositionDatabase.samePhysicalIdentity(
        database.treasury,
        database.ingestion
      )
    )
      context.addIssue({ code: 'custom', message: 'Invalid replay runtime' });
  });
