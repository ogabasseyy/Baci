import 'server-only';

const PREFIX = 'PIGGYVEST_SAVINGS_FUNDING_';

function read(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const value = env[`${PREFIX}${name}`]?.trim();
  return value ? value : undefined;
}

type InterestRoutingAttestation = {
  attestationId: string;
  businessId: string;
  globalSplit: string;
};

// Interest may only accrue into the plan's own wallet after a complete,
// exact owner attestation: the verified marker, owner author, matching
// business, exact global split, and a live (unexpired) attestation lease.
// Anything else fails closed to unverified with no attestation record.
function readInterestRoutingAttestation(
  env: NodeJS.ProcessEnv,
  expectedBusinessId: string | undefined
): InterestRoutingAttestation | null {
  const verified = read('INTEREST_ROUTING_VERIFIED', env);
  const attestationId = read('INTEREST_ROUTING_ATTESTATION_ID', env);
  const attestedBy = read('INTEREST_ROUTING_ATTESTED_BY', env);
  const businessId = read('INTEREST_ROUTING_BUSINESS_ID', env);
  const globalSplit = read('INTEREST_ROUTING_GLOBAL_SPLIT', env);
  const expiresAt = read('INTEREST_ROUTING_EXPIRES_AT', env);
  if (
    verified !== 'owner-attested' ||
    !attestationId ||
    attestedBy !== 'owner' ||
    !businessId ||
    businessId !== expectedBusinessId ||
    globalSplit !== '9%/3%' ||
    !expiresAt
  ) {
    return null;
  }
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
    return null;
  }
  return { attestationId, businessId, globalSplit };
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
  const businessId = read('BUSINESS_ID', env);
  const routingAttestation = readInterestRoutingAttestation(env, businessId);
  const configuration = {
    apiBaseUrl: undefined,
    apiSecret: read('API_SECRET', env),
    expectedBusinessId: businessId,
    environment: 'staging',
    integrationId: read('INTEGRATION_ID', env),
    expectedMerchantId: read('MERCHANT_ID', env),
    expectedProjectId: projectId,
    actualProjectId: projectId,
    allowlistedCustomerIds: allowlist,
    provisioningApproved: true,
    syntheticIdentityApproved: true,
    fingerprintKey: read('FINGERPRINT_KEY', env),
    defaultInterestRoutingVerified: routingAttestation !== null,
    ...(routingAttestation
      ? { defaultInterestRoutingAttestation: routingAttestation }
      : {}),
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
