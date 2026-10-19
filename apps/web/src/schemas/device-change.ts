import { piggyvestDeviceChangeSchemas as shared } from '@baci/shared/contracts';
import { z } from 'zod';

export const deviceChangeSchemas = {
  ...shared,
  quoteRows: z.array(z.strictObject({ result: shared.quote })).length(1),
  receiptRows: z.array(z.strictObject({ result: shared.receipt })).length(1),
};
