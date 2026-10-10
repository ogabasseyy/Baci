import { z } from 'zod';
import { piggyvestPostgresConfigurationSchema } from './piggyvest-postgres-configuration';
import { piggyvestWebhookIntakeConfigurationSchema } from './piggyvest-webhook-intake';

export const piggyvestStagingRuntimeSchema = z
  .strictObject({
    intake: piggyvestWebhookIntakeConfigurationSchema,
    intakeDatabase: piggyvestPostgresConfigurationSchema,
    workerDatabase: piggyvestPostgresConfigurationSchema,
  })
  .superRefine((configuration, context) => {
    const intake = configuration.intakeDatabase;
    const worker = configuration.workerDatabase;
    const sameStorage =
      intake.transport === worker.transport &&
      intake.database === worker.database &&
      intake.port === worker.port &&
      (intake.transport === 'local_test' && worker.transport === 'local_test'
        ? intake.socketDirectory === worker.socketDirectory
        : intake.transport === 'tls' &&
          worker.transport === 'tls' &&
          intake.host === worker.host &&
          intake.actualProjectId === worker.actualProjectId &&
          intake.actualProjectId === configuration.intake.actualProjectId);
    if (
      !sameStorage ||
      intake.role !== 'piggyvest_staging_intake' ||
      worker.role !== 'piggyvest_staging_worker'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Staging runtime identity mismatch',
      });
    }
  });
