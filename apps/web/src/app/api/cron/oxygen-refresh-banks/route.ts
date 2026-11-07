import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { readOxygenRuntimeConfiguration } from '@/lib/payments/oxygen/runtime-configuration';
import { connectOxygenRuntime } from '@/lib/payments/oxygen/runtime-connection';
import { refreshSupportedBanks } from '@/lib/payments/oxygen/supported-bank-cache';
import { getRedis } from '@/lib/redis';

const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET))
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  try {
    const config = readOxygenRuntimeConfiguration();
    const connection = connectOxygenRuntime();
    const cache = getRedis();
    if (
      !config ||
      !connection ||
      !cache ||
      connection.provider.environment !== config.environment
    )
      throw new Error('Unavailable');
    const banks = await refreshSupportedBanks(
      cache,
      connection.provider,
      config.environment,
      config.reference
    );
    return Response.json({ count: banks.length }, { headers });
  } catch {
    return Response.json(
      { error: 'Bank list refresh unavailable' },
      { status: 503, headers }
    );
  }
}
