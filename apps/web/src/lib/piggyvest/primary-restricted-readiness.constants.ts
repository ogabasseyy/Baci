export const primaryRestrictedReadinessRequirements = {
  maxEvidenceAgeMs: 3_600_000,
  maxApprovalWindowMs: 86_400_000,
  environmentVariables: [
    'PIGGYVEST_PRIMARY_ENABLED',
    'PIGGYVEST_PRIMARY_ENVIRONMENT',
    'PIGGYVEST_PRIMARY_MERCHANT_ID',
    'PIGGYVEST_PRIMARY_INTEGRATION_ID',
    'PIGGYVEST_PRIMARY_BUSINESS_ID',
    'PIGGYVEST_PRIMARY_BUSINESS_BINDING_VERIFIED',
    'PIGGYVEST_PRIMARY_FINGERPRINT_KEY',
    'PIGGYVEST_PRIMARY_PROVIDER_TOKEN',
    'PIGGYVEST_PRIMARY_DB_HOST',
    'PIGGYVEST_PRIMARY_DB_PORT',
    'PIGGYVEST_PRIMARY_DB_NAME',
    'PIGGYVEST_PRIMARY_DB_PASSWORD',
    'PIGGYVEST_PRIMARY_DB_CA',
    'PIGGYVEST_PRIMARY_SAVINGS_PROVISIONING_ENABLED',
    'PIGGYVEST_PRIMARY_GOAL_PROVISIONER_DB_PASSWORD',
  ],
  capabilities: [
    {
      gate: 'onboarding_role',
      login: 'baci_piggyvest_primary_provisioner',
      group: 'piggyvest_primary_provisioner',
      functions: [
        'piggyvest_primary.claim_onboarding(jsonb,text)',
        'piggyvest_primary.record_onboarding(jsonb,uuid,uuid,text,text)',
        'piggyvest_primary.record_onboarding_rejection(jsonb,uuid,uuid)',
        'piggyvest_primary.read_onboarding(jsonb)',
        'piggyvest_primary.verify_onboarding(jsonb,jsonb)',
      ],
    },
    {
      gate: 'provisioning_role',
      login: 'baci_piggyvest_primary_goal_provisioner',
      group: 'piggyvest_primary_goal_provisioner',
      functions: [
        'piggyvest_primary.read_goal_wallet(jsonb,uuid)',
        'piggyvest_primary.prepare_goal_wallet(jsonb,uuid,boolean)',
        'piggyvest_primary.record_goal_wallet(jsonb,uuid,uuid,text)',
        'piggyvest_primary.enroll_goal_wallet(jsonb,uuid,jsonb)',
      ],
    },
  ],
  routes: [
    {
      path: '/api/storefront/customer/wallet/piggyvest-primary',
      methods: ['GET', 'POST'],
      handler:
        'apps/web/src/app/api/storefront/customer/wallet/piggyvest-primary/route.ts',
    },
    {
      path: '/api/storefront/customer/savings/primary-provisioning',
      methods: ['POST', 'PATCH'],
      handler:
        'apps/web/src/app/api/storefront/customer/savings/primary-provisioning/route.ts',
    },
  ],
} as const;
