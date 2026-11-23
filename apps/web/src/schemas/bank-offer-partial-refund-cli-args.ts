import { z } from 'zod';

export const partialRefundCliArgsSchema = z.tuple([
  z.uuid(),
  z.uuid(),
  z.string().min(1),
]);
