import { z } from 'zod';
import { prefundedCardWorkerSchemas } from '../../../src/schemas/prefunded-card-worker';
import { replayFinancialSchemas } from './replay-financial';

export const replayPaidInterestSchemas = {
  database: replayFinancialSchemas.database.options[1],
  scope: replayFinancialSchemas.scope.extend({
    expectedSystemId: z.literal('7685292944002592802'),
  }),
  factoryConfiguration: z.object({
    scope: prefundedCardWorkerSchemas.scope.omit({ batchSize: true }),
  }),
};
