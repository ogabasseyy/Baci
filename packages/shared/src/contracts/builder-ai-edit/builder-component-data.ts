import { z } from 'zod';

export const builderComponentDataSchema = z.looseObject({
  props: z.record(z.string(), z.unknown()).default({}),
  type: z.string().trim().min(1).max(80),
});
