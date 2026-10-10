export const provisioningFixture = {
  scope: {
    merchantId: '00000000-0000-4000-8000-000000000001',
    customerId: '00000000-0000-4000-8000-000000000002',
    userId: '00000000-0000-4000-8000-000000000003',
    integrationId: '00000000-0000-4000-8000-000000000004',
    businessId: 'business',
    environment: 'staging' as const,
  },
  goalId: '00000000-0000-4000-8000-000000000006',
  configuration: {
    onboarding: {
      merchantId: '00000000-0000-4000-8000-000000000001',
      integrationId: '00000000-0000-4000-8000-000000000004',
      businessId: 'business',
      environment: 'staging' as const,
      businessBindingVerified: true,
      fingerprintKey: 'test-only-fingerprint-key-not-a-real-secret',
    },
    providerToken: 'test-only-token',
    database: {
      host: 'db.example.test',
      port: 5432,
      name: 'postgres',
      login: 'baci_piggyvest_primary_goal_provisioner' as const,
      password: 'test-only-password',
      certificateAuthority: 'test-only-ca',
    },
  },
};
