import { z } from 'zod';

const receiverOrigin = z.url().refine((value) => {
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
    url.pathname === '/' &&
    !url.search &&
    !url.hash
  );
});

const config = z
  .strictObject({
    receiverOrigin,
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
  })
  .superRefine((value, context) => {
    let endpointOrigin: string;
    let configuredOrigin: string;
    try {
      endpointOrigin = new URL(value.endpoint).origin;
      configuredOrigin = new URL(value.receiverOrigin).origin;
    } catch {
      return;
    }
    if (endpointOrigin !== configuredOrigin) {
      context.addIssue({
        code: 'custom',
        path: ['endpoint'],
        message: 'Endpoint origin must match receiverOrigin',
      });
    }
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
