import { z } from 'zod';
import { BRILSTASH_PILOT_LISTING_LIMIT } from '../config/brilstash-feed';

const revision = z.string().regex(/^\d+$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);

export const brilStashProbeStateSchema = z.strictObject({
  installationId: z.uuid(),
  generationId: z.uuid(),
  credentialId: z.uuid(),
  catalogueRevision: revision,
  servingRevision: revision,
  credentialRevision: revision,
  payloadDigest: digest,
  totalCount: z.int().min(1).max(BRILSTASH_PILOT_LISTING_LIMIT),
});

export type BrilStashProbeState = z.infer<typeof brilStashProbeStateSchema>;
