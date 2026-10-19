import { z } from 'zod';

function isAnonJwt(value: string): boolean {
  const segments = value.split('.');
  if (segments.length !== 3) return false;
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(segments[1], 'base64url').toString('utf8')
    );
    return (
      typeof payload === 'object' &&
      payload !== null &&
      (payload as Record<string, unknown>).role === 'anon'
    );
  } catch {
    return false;
  }
}

// Public launch credentials for the isolated first-card checkout worker:
// the staging auth origin plus a public anon JWT. Strict shape (no extra
// keys), privileged roles refused.
export const firstCardLaunchAuthSchema = z.strictObject({
  url: z.literal('https://staging-auth.ogabassey.com'),
  key: z.string().min(1).refine(isAnonJwt, 'Invalid anon key'),
});
