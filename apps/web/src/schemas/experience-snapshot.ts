import { z } from 'zod';
export const experienceSnapshotKeySchema = z.strictObject({
  build: z.string().regex(/^[a-f0-9]{64}$/),
  assets: z.string().regex(/^[a-f0-9]{64}$/),
  catalog: z.string().min(1).max(128).nullable(),
  path: z.string().max(1024),
  viewport: z.enum(['360', '390', '768', '1280', '1440']).optional(),
  locale: z.string().min(2).max(35).optional(),
  browser: z.enum(['chromium', 'firefox', 'webkit']).optional(),
  state: z.string().min(1).max(80).optional(),
  extractor: z.literal('semantic-v1').default('semantic-v1'),
});
