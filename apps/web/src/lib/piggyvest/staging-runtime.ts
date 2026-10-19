import 'server-only';
import { piggyvestStagingRuntimeSchema } from '@/schemas/piggyvest-staging-runtime';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import { createPiggyvestPostgresInbox } from './postgres-inbox';
import { quarantinePiggyvestInboxBatch } from './quarantine-inbox';
import { acceptPiggyvestStagingRequest } from './webhook-request';

export function createPiggyvestStagingRuntime(configuration: unknown) {
  const parsed = piggyvestStagingRuntimeSchema.safeParse(configuration);
  if (!parsed.success) throw new Error('PiggyVest staging runtime unavailable');
  const config = parsed.data;
  const intakeExecutor = createPiggyvestPostgresExecutor(config.intakeDatabase);
  const workerExecutor = createPiggyvestPostgresExecutor(config.workerDatabase);
  const inbox = createPiggyvestPostgresInbox({
    integrationId: config.intake.integrationId,
    execute: intakeExecutor,
  });

  return {
    accept(request: Pick<Request, 'body' | 'headers' | 'signal'>) {
      return acceptPiggyvestStagingRequest({
        configuration: config.intake,
        request,
        inbox,
      });
    },
    quarantine() {
      return quarantinePiggyvestInboxBatch({
        configuration: {
          environment: 'staging',
          integrationId: config.intake.integrationId,
          batchSize: 10,
          leaseSeconds: 60,
        },
        execute: workerExecutor,
      });
    },
  };
}
