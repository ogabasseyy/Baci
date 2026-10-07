import 'server-only';
import { prefundedCardCheckoutPublicSchemas } from '@/schemas/prefunded-card-checkout-public-runtime';
import { createPrefundedCardPostgresExecutor } from './prefunded-card-postgres-executor';

export async function verifyFirstCardLaunchReadiness(
  configuration: unknown,
  now = Date.now()
) {
  try {
    const config =
      prefundedCardCheckoutPublicSchemas.configuration.parse(configuration);
    if (
      !Number.isFinite(now) ||
      now >= Date.parse(config.expiresAt) ||
      config.maximumAmountKobo > 10_000
    )
      throw new Error();
    const identities = [
      { ...config.checkout.customerDatabase, profile: 'worker' },
      { ...config.checkout.verifierDatabase, profile: 'authorizer' },
    ];
    for (const identity of identities) {
      const execute = createPrefundedCardPostgresExecutor(identity);
      const result = await execute('SELECT true AS result', []);
      const row = result.rows[0];
      if (
        result.rows.length !== 1 ||
        typeof row !== 'object' ||
        row === null ||
        !('result' in row) ||
        row.result !== true
      )
        throw new Error();
    }
    return {
      status: 'public-private-ready',
      customerTlsVerified: true,
      verifierTlsVerified: true,
      httpStarted: false,
    } as const;
  } catch {
    throw new Error('First-card private readiness refused');
  }
}
