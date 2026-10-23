import { z } from 'zod';
import { portableHomeSchema } from './portable-storefront';

export const portablePublishedSnapshotSchema = z
  .object({
    config: portableHomeSchema,
    publishedVersion: z.string().regex(/^home-v1:[a-f0-9]{64}$/),
  })
  .strict();
export type PortablePublishedSnapshot = z.infer<
  typeof portablePublishedSnapshotSchema
>;
