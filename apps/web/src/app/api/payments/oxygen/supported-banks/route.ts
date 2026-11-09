import { authenticateApiRequest } from '@/lib/api-auth';
import { readOxygenRuntimeConfiguration } from '@/lib/payments/oxygen/runtime-configuration';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { readOrRefreshSupportedBanks } from '@/lib/payments/oxygen/supported-bank-cache';
import { checkOxygenProviderRateLimit } from '@/lib/rate-limit';
import { getRedis } from '@/lib/redis';

const headers = { 'Cache-Control': 'no-store' };
/** Cache-first read: only a cold cache reaches the provider, and then once. */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user)
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  try {
    if (
      !(await checkOxygenProviderRateLimit(auth.user.id, 'supported-banks', 30))
        .allowed
    )
      return Response.json(
        { error: 'Too many requests' },
        { status: 429, headers }
      );
    const config = readOxygenRuntimeConfiguration();
    const cache = getRedis();
    if (!config || !cache) throw new Error('Unavailable');
    const banks = await readOrRefreshSupportedBanks(
      cache,
      config.environment,
      config.reference,
      () => {
        const connection = connectOxygenRuntime();
        return connection?.provider.environment === config.environment
          ? connection.provider
          : null;
      }
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
