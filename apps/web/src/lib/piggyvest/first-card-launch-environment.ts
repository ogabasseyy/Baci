import { firstCardLaunchAuthSchema } from '@/schemas/first-card-launch-auth';
import { hostedFirstCardEnvironmentSchema } from '@/schemas/hosted-first-card-environment';
import { prefundedCardKnownDeadlineSchema } from '@/schemas/prefunded-card-known-deadline';

export function createFirstCardLaunchEnvironment(
  configuration: unknown,
  publicAuth: unknown,
  now = Date.now(),
  mutationsEnabled = false
): Record<string, string> {
  try {
    if (typeof mutationsEnabled !== 'boolean') throw new Error();
    const auth = firstCardLaunchAuthSchema.parse(publicAuth);
    const environment = {
      NODE_ENV: 'production',
      BACI_WORKER_PROFILE: 'hosted-first-card-checkout',
      HOSTNAME: '0.0.0.0',
      PORT: '3000',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: '/tmp',
      NEXT_PUBLIC_SUPABASE_URL: auth.url,
      NEXT_PUBLIC_APP_URL: 'https://staging.ogabassey.com',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: auth.key,
      PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED: 'true',
      PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED: String(mutationsEnabled),
      PREFUNDED_CARD_CHECKOUT_PUBLIC_CONFIG: JSON.stringify(configuration),
      PREFUNDED_CARD_PUBLIC_ENABLED: 'false',
    };
    hostedFirstCardEnvironmentSchema.parse(environment);
    const configurationExpiry =
      configuration !== null &&
      typeof configuration === 'object' &&
      'expiresAt' in configuration
        ? configuration.expiresAt
        : undefined;
    const expiresAt =
      prefundedCardKnownDeadlineSchema.parse(configurationExpiry);
    if (!Number.isFinite(now) || now >= Date.parse(expiresAt))
      throw new Error();
    return environment;
  } catch {
    throw new Error('First-card launch refused');
  }
}
