import { createHash } from 'node:crypto';

const integrationId = '11111111-1111-4111-8111-111111111111';
const merchantId = '22222222-2222-4222-8222-222222222222';
const treasuryBindingId = '33333333-3333-4333-8333-333333333333';
const businessId = 'synthetic-business-id';
const systemIdentifier = '7685292944002592802';
const certificateAuthority = 'synthetic CA used only by this test';
const certificateAuthoritySha256 = createHash('sha256')
  .update(certificateAuthority)
  .digest('hex');

function database(profile: string, login: string) {
  return {
    environment: 'staging',
    profile,
    transport: 'tls',
    host: 'db.staging.example.test',
    expectedHost: 'db.staging.example.test',
    port: 5432,
    login,
    expectedLogin: login,
    database: 'prefunded_staging',
    expectedDatabase: 'prefunded_staging',
    expectedSystemId: systemIdentifier,
    expectedProjectId: 'synthetic-project',
    actualProjectId: 'synthetic-project',
    certificateAuthority,
    password: 'synthetic-test-only',
    storageApproved: true,
  };
}

function backgroundDatabase(login: string) {
  const { profile, ...value } = database('', login);
  void profile;
  return value;
}

export function createActivationConfigFixture() {
  const scope = {
    deployment: 'staging',
    integrationId,
    merchantId,
    treasuryBindingId,
    businessId,
    systemIdentifier,
    expiresAt: '2026-09-29T15:59:10Z',
  };
  const piggyvest = {
    apiBaseUrl: 'https://staging.piggyvest.business',
    apiSecret: 'synthetic-test-only',
    expectedBusinessId: businessId,
    expectedCurrency: 'NGN',
    timeoutMs: 5000,
    maxResponseBytes: 65536,
  };
  const webhookSecret = 'synthetic-webhook-secret';
  const paystackSecret = 'sk_test_synthetic';
  const checkoutScope = {
    deployment: 'staging',
    integrationId,
    merchantId,
    treasuryBindingId,
    businessId,
    systemIdentifier,
    expiresAt: '2026-09-29T15:59:10Z',
  };
  const callbackUrl = 'https://staging.ogabassey.com/savings/card-return';
  const checkout = {
    scope: checkoutScope,
    customerDatabase: database(
      'checkout_customer',
      'prefunded_treasury_operator'
    ),
    verifierDatabase: database('checkout_authorizer', 'prefunded_authorizer'),
    provider: { ...scope, paystackSecret, callbackUrl },
  };
  const evidence = (secret: string) => ({
    integrationId,
    systemIdentifier,
    webhookSecret: secret,
    piggyvest: { ...piggyvest },
  });
  const publicContext = {
    environment: 'staging',
    transport: 'tls',
    integrationId,
    expectedBusinessId: businessId,
    merchantId,
    allowlistedMerchantIds: [merchantId],
    allowlistedCustomerIds: ['44444444-4444-4444-8444-444444444444'],
    expectedProjectId: 'synthetic-project',
    actualProjectId: 'synthetic-project',
  };

  return {
    expected: {
      systemIdentifier,
      expiresAt: '2026-09-29T15:59:10Z',
      database: 'prefunded_staging',
      projectId: 'synthetic-project',
      host: 'db.staging.example.test',
      port: 5432,
      certificateAuthoritySha256,
    },
    origins: {
      piggyvestApi: 'https://staging.piggyvest.business',
      paystackApi: 'https://api.paystack.co',
      paystackCheckout: 'https://checkout.paystack.com',
      public: 'https://staging.ogabassey.com',
      auth: 'https://staging-auth.ogabassey.com',
    },
    background: {
      worker: {
        environment: 'staging',
        integrationId,
        merchantId,
        treasuryBindingId,
        businessId,
        expectedSystemId: systemIdentifier,
        batchSize: 5,
      },
      provider: {
        paystackSecret,
        piggyvest: { ...piggyvest },
        scope: {
          integrationId,
          merchantId,
          treasuryBindingId,
          sourceWalletId: 'owner-supplied-test-wallet',
        },
      },
      evidence: evidence(webhookSecret),
      database: {
        treasury: backgroundDatabase('prefunded_treasury_operator'),
        ingestion: backgroundDatabase('prefunded_evidence'),
        authorizer: backgroundDatabase('prefunded_authorizer'),
      },
    },
    publicCheckout: {
      deployment: 'staging',
      expiresAt: '2026-09-29T15:59:10Z',
      publicOrigin: 'https://staging.ogabassey.com',
      authOrigin: 'https://staging-auth.ogabassey.com',
      maximumAmountKobo: 100000,
      context: publicContext,
      checkout,
    },
    savedCardPublicRuntime: {
      deployment: 'staging',
      expiresAt: '2026-09-29T15:59:10Z',
      publicOrigin: 'https://staging.ogabassey.com',
      authOrigin: 'https://staging-auth.ogabassey.com',
      context: publicContext,
      database: database('customer', 'prefunded_treasury_operator'),
    },
    receiverReplayRuntime: {
      expectedAppSystemId: systemIdentifier,
      configuration: {
        scope: {
          environment: 'staging',
          integrationId,
          merchantId,
          treasuryBindingId,
          businessId,
          expectedSystemId: systemIdentifier,
        },
        evidence: evidence(webhookSecret),
        database: {
          treasury: backgroundDatabase('prefunded_treasury_operator'),
          ingestion: backgroundDatabase('prefunded_evidence'),
        },
      },
    },
    recovery: {
      scope: checkoutScope,
      authorizerDatabase: database(
        'checkout_authorizer',
        'prefunded_authorizer'
      ),
      provider: { ...scope, paystackSecret, callbackUrl },
    },
  };
}
