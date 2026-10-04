import 'server-only';

const PREFIX = 'PIGGYVEST_SAVINGS_FUNDING_';

function read(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const value = env[`${PREFIX}${name}`]?.trim();
  return value ? value : undefined;
}

export function readPiggyvestPlanFundingRuntime(
  env: NodeJS.ProcessEnv = process.env
): {
  configuration: unknown;
  postgresConfiguration: unknown;
} | null {
  if (read('DISPLAY_ENABLED', env) !== 'true') return null;
  const allowlist =
    read('CUSTOMER_ALLOWLIST', env)
      ?.split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0) ?? [];
  const projectId = read('PROJECT_ID', env);
  const portText = read('DB_PORT', env);
  const configuration = {
    apiBaseUrl: undefined,
    apiSecret: read('API_SECRET', env),
    expectedBusinessId: read('BUSINESS_ID', env),
    environment: 'staging',
    integrationId: read('INTEGRATION_ID', env),
    expectedMerchantId: read('MERCHANT_ID', env),
    expectedProjectId: projectId,
    actualProjectId: projectId,
    allowlistedCustomerIds: allowlist,
    provisioningApproved: true,
    syntheticIdentityApproved: true,
    fingerprintKey: read('FINGERPRINT_KEY', env),
  };
  const postgresConfiguration = {
    environment: 'staging',
    role: 'piggyvest_staging_provisioner',
    transport: 'tls',
    host: read('DB_HOST', env),
    expectedHost: read('DB_HOST', env),
    port: portText === undefined ? undefined : Number(portText),
    database: read('DB_NAME', env),
    password: read('DB_PASSWORD', env),
    storageApproved: true,
    expectedProjectId: projectId,
    actualProjectId: projectId,
    certificateAuthority: read('DB_CA', env),
  };
  return { configuration, postgresConfiguration };
}
