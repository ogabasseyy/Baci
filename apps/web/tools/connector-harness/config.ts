/**
 * R0 connector harness configuration.
 *
 * Test-only: the harness refuses to start in production or without the
 * explicit enable flag. All values come from the environment; nothing is
 * defaulted except host/port.
 */

export interface HarnessConfig {
  host: string;
  port: number;
  databaseUrl: string;
  /** Bearer secret guarding manual test-token issuance and revocation. */
  ownerSecret: string;
  /** Test owner identity used for manual issuance (local/staging only). */
  testOwnerUserId: string;
  testMerchantId: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function required(
  env: Record<string, string | undefined>,
  name: string
): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`harness_config_missing:${name}`);
  }
  return value;
}

function requiredUuid(
  env: Record<string, string | undefined>,
  name: string
): string {
  const value = required(env, name);
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`harness_config_invalid:${name}`);
  }
  return value;
}

export function loadHarnessConfig(
  env: Record<string, string | undefined>
): HarnessConfig {
  if (env.NODE_ENV === 'production') {
    throw new Error('harness_refused_production');
  }
  if (env.HARNESS_ENABLED !== '1') {
    throw new Error('harness_not_enabled');
  }

  const portRaw = env.HARNESS_PORT?.trim() || '3101';
  const port = Number(portRaw);
  // Port 0 selects an ephemeral port (used by the runtime regression suite).
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('harness_config_invalid:HARNESS_PORT');
  }

  const ownerSecret = required(env, 'HARNESS_OWNER_SECRET');
  if (ownerSecret.length < 32) {
    throw new Error('harness_config_invalid:HARNESS_OWNER_SECRET');
  }

  return {
    host: env.HARNESS_HOST?.trim() || '127.0.0.1',
    port,
    databaseUrl: required(env, 'HARNESS_DATABASE_URL'),
    ownerSecret,
    testOwnerUserId: requiredUuid(env, 'HARNESS_TEST_OWNER_USER_ID'),
    testMerchantId: requiredUuid(env, 'HARNESS_TEST_MERCHANT_ID'),
  };
}
