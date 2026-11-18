import { z } from 'zod';

const origin = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return (
        parsed.origin === value &&
        !parsed.username &&
        !parsed.password &&
        (parsed.protocol === 'https:' ||
          (parsed.protocol === 'http:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)))
      );
    } catch {
      return false;
    }
  }, 'Expected a canonical secure origin');

export const oxygenMobileCapabilitiesSchema = z
  .object({
    schemaVersion: z.literal(1),
    environment: z.enum(['staging', 'production']),
    authOrigin: origin,
    authBaseUrl: z.string().max(2048).optional(),
    merchant: z
      .object({
        id: z.uuid(),
        slug: z
          .string()
          .min(1)
          .max(100)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      })
      .strict(),
    mobileEnabled: z.boolean(),
    reason: z.string().min(1).max(160).nullable(),
    hostedOrigins: z.array(origin).max(32),
    selfieOrigins: z.array(origin).max(32),
  })
  .strict()
  .refine(
    (value) =>
      value.selfieOrigins.every((host) => value.hostedOrigins.includes(host)),
    {
      message: 'Selfie origins must be approved hosted origins',
      path: ['selfieOrigins'],
    }
  )
  .refine((value) => {
    if (value.authBaseUrl === undefined) return true;
    try {
      const url = new URL(value.authBaseUrl);
      if (
        url.origin !== value.authOrigin ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return false;
      return (
        value.authBaseUrl === value.authOrigin ||
        (value.environment === 'staging' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
          url.pathname === '/qa-backend' &&
          value.authBaseUrl === `${url.origin}/qa-backend`)
      );
    } catch {
      return false;
    }
  }, 'Invalid Auth base URL');
export type OxygenMobileCapabilities = z.infer<
  typeof oxygenMobileCapabilitiesSchema
>;
