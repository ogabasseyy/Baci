import { z } from 'zod';

const sourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      url: z.string(),
      kind: z.literal('official_markdown'),
      fetch: z.literal(true),
    })
    .strict(),
  z
    .object({
      url: z.string(),
      kind: z.literal('quarantined_reference_only'),
      fetch: z.literal(false),
    })
    .strict(),
]);
export const sourceManifestSchema = z
  .object({ version: z.literal(1), sources: z.array(sourceSchema) })
  .strict();
