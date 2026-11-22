import { z } from 'zod';

export const partialRefundDatabaseUrlSchema = z.url({
  protocol: /^postgres(?:ql)?$/,
});
