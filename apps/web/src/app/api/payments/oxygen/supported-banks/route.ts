import { authenticateApiRequest } from '@/lib/api-auth';
import { readOxygenRuntimeConfiguration } from '@/lib/payments/oxygen/runtime-configuration';
import { readSupportedBanks } from '@/lib/payments/oxygen/supported-bank-cache';
import { checkOxygenProviderRateLimit } from '@/lib/rate-limit';
import { getRedis } from '@/lib/redis';

const headers = { 'Cache-Control': 'no-store' };
/** Cache-only read: opening checkout never contacts the provider. */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user)
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  try {
    const limit = await checkOxygenProviderRateLimit(
      auth.user.id,
      'supported-banks',
      30
    );
    if (!limit.allowed) {
      const retryAfter = Math.max(
        1,
        Math.ceil((limit.resetTime - Date.now()) / 1000)
      );
      return Response.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: {
            ...headers,
            'Retry-After': String(retryAfter),
            'X-Oxygen-Rate-Limit-Scope': 'user',
            'X-Oxygen-Rate-Limit-User': auth.user.id,
          },
        }
      );
    }
    const config = readOxygenRuntimeConfiguration();
    const cache = getRedis();
    if (!config || !cache) throw new Error('Unavailable');
    const banks = await readSupportedBanks(
      cache,
      config.environment,
      config.reference
    );
    if (!banks) throw new Error('Unavailable');
    return Response.json({ banks }, { headers });
  } catch {
    return Response.json(
      { error: 'Bank list unavailable' },
      { status: 503, headers }
    );
  }
}
