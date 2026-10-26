import { z } from 'zod';

const config = z.strictObject({
  endpoint: z.url().refine((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/piggyvest/intake'
    );
  }),
  integrationId: z.uuid(),
  environment: z.literal('production'),
  relayToken: z
    .string()
    .min(32)
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/),
});
const acknowledgement = z.strictObject({
  integrationId: z.uuid(),
  environment: z.literal('production'),
  bodyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  outcome: z.enum([
    'accepted',
    'duplicate',
    'quarantined',
    'invalid_signature',
    'unavailable',
  ]),
});

export const piggyvestLiveRelaySchemas = { config, acknowledgement };
