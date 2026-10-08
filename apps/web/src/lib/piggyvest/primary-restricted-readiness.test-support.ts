export function primaryReadinessFixture() {
  const integrationId = '00000000-0000-4000-8000-000000000001';
  const merchantId = '00000000-0000-4000-8000-000000000002';
  const artifactDigest = 'a'.repeat(64);
  const onboarding = 'baci_piggyvest_primary_provisioner';
  const provisioning = 'baci_piggyvest_primary_goal_provisioner';
  const group = (name: string) => ({
    name,
    canLogin: false,
    superuser: false,
    bypassRls: false,
    createRole: false,
    createDatabase: false,
    replication: false,
    memberships: [] as string[],
  });
  const role = (
    login: string,
    capability: string,
    executableFunctions: string[]
  ) => ({
    login,
    canLogin: true,
    superuser: false,
    bypassRls: false,
    createRole: false,
    createDatabase: false,
    replication: false,
    memberships: [capability],
    capabilityGroup: group(capability),
    validUntil: '2026-10-07T13:00:00Z' as string | null,
    schemaUsage: true,
    directTableAccess: false,
    publicFunctionExecution: false,
    executableFunctions,
    databaseName: 'postgres',
    sessionUser: login,
    currentUser: login,
    tls: true,
    certificateVerified: true,
    hostnameVerified: true,
    databaseHost: 'db.example.com',
    databasePort: 5432,
  });
  const route = (
    path: string,
    method: 'GET' | 'POST' | 'PATCH',
    handlerModule: string
  ) => ({
    path,
    method,
    handlerModule,
    artifactDigest,
    status: 401,
    authentication: 'unauthenticated' as const,
    requestBodySent: false,
    providerCalls: 0,
    databaseWrites: 0,
    applicationOrigin: 'https://app.example.com',
    observedAt: '2026-10-07T12:00:00Z',
  });
  return {
    source: 'synthetic' as 'synthetic' | 'operator_inventory',
    capturedAt: '2026-10-07T12:00:00Z',
    expiresAt: '2026-10-07T13:00:00Z',
    configuration: {
      environment: 'staging' as 'staging' | 'production',
      deploymentEnvironment: 'preview' as
        | 'preview'
        | 'production'
        | 'development',
      providerOrigin: 'https://staging.piggyvest.business',
      applicationOrigin: 'https://app.example.com',
      merchantId,
      integrationId,
      businessId: 'business-with-hyphens',
      databaseHost: 'db.example.com',
      databaseName: 'postgres',
      databasePort: 5432,
      artifactDigest,
      onboardingRuntimeValidated: true,
      provisioningRuntimeValidated: true,
      businessBindingVerified: true,
    },
    integration: {
      integrationId,
      merchantId,
      businessId: 'business-with-hyphens',
      environment: 'staging' as 'staging' | 'production',
      executorLogin: onboarding,
      enabled: true,
    },
    goalAuthority: {
      integrationId,
      executorLogin: provisioning,
      enabled: true,
    },
    roles: [
      role(onboarding, 'piggyvest_primary_provisioner', [
        'piggyvest_primary.claim_onboarding(jsonb,text)',
        'piggyvest_primary.record_onboarding(jsonb,uuid,uuid,text,text)',
        'piggyvest_primary.read_onboarding(jsonb)',
        'piggyvest_primary.verify_onboarding(jsonb,jsonb)',
      ]),
      role(provisioning, 'piggyvest_primary_goal_provisioner', [
        'piggyvest_primary.read_goal_wallet(jsonb,uuid)',
        'piggyvest_primary.prepare_goal_wallet(jsonb,uuid,boolean)',
        'piggyvest_primary.record_goal_wallet(jsonb,uuid,uuid,text)',
        'piggyvest_primary.enroll_goal_wallet(jsonb,uuid,jsonb)',
      ]),
    ],
    routes: [
      route(
        '/api/storefront/customer/wallet/piggyvest-primary',
        'GET',
        'apps/web/src/app/api/storefront/customer/wallet/piggyvest-primary/route.ts'
      ),
      route(
        '/api/storefront/customer/wallet/piggyvest-primary',
        'POST',
        'apps/web/src/app/api/storefront/customer/wallet/piggyvest-primary/route.ts'
      ),
      route(
        '/api/storefront/customer/savings/primary-provisioning',
        'POST',
        'apps/web/src/app/api/storefront/customer/savings/primary-provisioning/route.ts'
      ),
      route(
        '/api/storefront/customer/savings/primary-provisioning',
        'PATCH',
        'apps/web/src/app/api/storefront/customer/savings/primary-provisioning/route.ts'
      ),
    ],
    regressionEvidence: {
      artifactDigest,
      authentication: true,
      csrf: true,
      exactOwnership: true,
      singleDispatch: true,
      immutableInterestChoice: true,
      providerOrigin: true,
    },
  };
}
