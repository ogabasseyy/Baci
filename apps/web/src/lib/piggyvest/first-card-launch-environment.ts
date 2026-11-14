import { firstCardLaunchAuthSchema } from '@/schemas/first-card-launch-auth';
import { hostedFirstCardEnvironmentSchema } from '@/schemas/hosted-first-card-environment';
import { prefundedCardKnownDeadlineSchema } from '@/schemas/prefunded-card-known-deadline';

export function createFirstCardLaunchEnvironment(
  configuration: unknown,
  publicAuth: unknown,
  now = Date.now(),
  mutationsEnabled = false,
  // The parent's PIGGYVEST_KILL_SWITCH. The child starts from a clean
  // environment, so a killed parent must be copied in explicitly.
  killSwitch: string | undefined = process.env.PIGGYVEST_KILL_SWITCH
): Record<string, string> {
  try {
    if (typeof mutationsEnabled !== 'boolean') throw new Error();
    const auth = firstCardLaunchAuthSchema.parse(publicAuth);
    const environment: Record<string, string> = {
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
      // The owner's flag is preserved even when killed: the copied kill switch
      // refuses new checkouts in the worker, while this flag keeps refresh of
      // an already-paid checkout available.
      PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED: String(mutationsEnabled),
      PREFUNDED_CARD_CHECKOUT_PUBLIC_CONFIG: JSON.stringify(configuration),
      PREFUNDED_CARD_PUBLIC_ENABLED: 'false',
    };
    if (killSwitch !== undefined)
      environment.PIGGYVEST_KILL_SWITCH = killSwitch;
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
