import { z } from 'zod';
import { builderComponentDataSchema } from './builder-component-data';
import { MAX_BUILDER_BLOCKS } from './limits';

export const builderDataSchema = z.looseObject({
  content: z.array(builderComponentDataSchema).max(MAX_BUILDER_BLOCKS),
  root: z.record(z.string(), z.unknown()),
  theme: z.record(z.string(), z.unknown()).optional(),
  zones: z.record(z.string(), z.unknown()).optional(),
});

export type BuilderData = z.infer<typeof builderDataSchema>;
