import { piggyvestCancellationRecoverySchemas as shared } from '@baci/shared/contracts';
import { z } from 'zod';

export const cancellationRecoveryRowsSchema = z
  .array(z.strictObject({ result: shared.response }))
  .length(1);
