import { z } from 'zod';

const publicKey = z
  .string()
  .min(20)
  .max(8192)
  .refine((value) => {
    if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(value)) return true;
    try {
      const segments = value.split('.');
      if (segments.length !== 3) return false;
      const payload: unknown = JSON.parse(
        Buffer.from(segments[1], 'base64url').toString('utf8')
      );
      return (
        typeof payload === 'object' &&
        payload !== null &&
        'role' in payload &&
        payload.role === 'anon'
      );
    } catch {
      return false;
    }
  });

export const runtimeCompositionAuthSchema = z
  .strictObject({
    url: z
      .string()
      .max(256)
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            url.origin === value &&
            !url.username &&
            !url.password &&
            ((url.protocol === 'https:' &&
              /^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname)) ||
              (url.protocol === 'http:' &&
                url.hostname === '127.0.0.1' &&
                Number(url.port) >= 1024))
          );
        } catch {
          return false;
        }
      }),
    publicKey,
    syntheticLoopback: z.literal(true).optional(),
  })
  .refine((configuration) =>
    configuration.url.startsWith('http:')
      ? configuration.syntheticLoopback === true
      : configuration.syntheticLoopback !== true
  );
