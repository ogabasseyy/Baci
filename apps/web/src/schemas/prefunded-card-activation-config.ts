import { z } from 'zod';
import { prefundedCardCheckoutPublicSchemas } from './prefunded-card-checkout-public-runtime';
import { prefundedCardCheckoutRecoverySchemas } from './prefunded-card-checkout-recovery';
import { prefundedCardCompositionSchema } from './prefunded-card-composition';
import { prefundedCardKnownDeadlineSchema } from './prefunded-card-known-deadline';
import { prefundedCardPublicRuntimeSchemas } from './prefunded-card-public-runtime';
import { prefundedCardReplayRuntimeSchema } from './prefunded-card-replay-runtime';

const systemIdentifier = '7685292944002592802';
const expected = z.strictObject({
  systemIdentifier: z.literal(systemIdentifier),
  expiresAt: prefundedCardKnownDeadlineSchema,
  database: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  projectId: z.string().min(1).max(128),
  host: z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
  port: z.number().int().min(1).max(65535),
  certificateAuthoritySha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const origins = z.strictObject({
  piggyvestApi: z.literal('https://staging.piggyvest.business'),
  paystackApi: z.literal('https://api.paystack.co'),
  paystackCheckout: z.literal('https://checkout.paystack.com'),
  public: z.literal('https://staging.ogabassey.com'),
  auth: z.literal('https://staging-auth.ogabassey.com'),
});

const config = z.strictObject({
  expected,
  origins,
  background: prefundedCardCompositionSchema,
  publicCheckout: prefundedCardCheckoutPublicSchemas.configuration,
  recovery: prefundedCardCheckoutRecoverySchemas.composition,
  savedCardPublicRuntime: prefundedCardPublicRuntimeSchemas.configuration,
  receiverReplayRuntime: z.strictObject({
    configuration: prefundedCardReplayRuntimeSchema.shape.configuration,
    expectedAppSystemId: z.literal(systemIdentifier),
  }),
});

export const prefundedCardActivationConfigSchema = config.superRefine(
  (value, context) => {
    const {
      expected,
      background,
      publicCheckout,
      recovery,
      savedCardPublicRuntime,
      receiverReplayRuntime,
      origins,
    } = value;
    const scope = background.worker;
    const checkout = publicCheckout.checkout;
    const scopes = [checkout.scope, recovery.scope];
    const databases = [
      background.database.treasury,
      background.database.ingestion,
      background.database.authorizer,
      checkout.customerDatabase,
      checkout.verifierDatabase,
      recovery.authorizerDatabase,
      savedCardPublicRuntime.database,
      receiverReplayRuntime.configuration.database.treasury,
      receiverReplayRuntime.configuration.database.ingestion,
    ];
    const inconsistent = (path: (string | number)[]) =>
      context.addIssue({
        code: 'custom',
        path,
        message: 'Inconsistent prerequisite',
      });

    if (
      scope.expectedSystemId !== expected.systemIdentifier ||
      scope.businessId !== background.provider.piggyvest.expectedBusinessId ||
      scope.businessId !== background.evidence.piggyvest.expectedBusinessId ||
      scope.integrationId !== background.provider.scope.integrationId ||
      scope.integrationId !== background.evidence.integrationId ||
      scope.merchantId !== background.provider.scope.merchantId ||
      scope.treasuryBindingId !== background.provider.scope.treasuryBindingId
    )
      inconsistent(['background', 'scope']);

    for (const candidate of scopes) {
      if (
        candidate.deployment !== 'staging' ||
        candidate.expiresAt !== expected.expiresAt ||
        candidate.systemIdentifier !== expected.systemIdentifier ||
        candidate.integrationId !== scope.integrationId ||
        candidate.merchantId !== scope.merchantId ||
        candidate.treasuryBindingId !== scope.treasuryBindingId ||
        candidate.businessId !== scope.businessId
      )
        inconsistent(['scope']);
    }

    if (
      publicCheckout.deployment !== 'staging' ||
      publicCheckout.expiresAt !== expected.expiresAt ||
      publicCheckout.publicOrigin !== origins.public ||
      publicCheckout.authOrigin !== origins.auth ||
      publicCheckout.context.integrationId !== scope.integrationId ||
      publicCheckout.context.merchantId !== scope.merchantId ||
      publicCheckout.context.expectedBusinessId !== scope.businessId ||
      !publicCheckout.context.allowlistedMerchantIds.includes(scope.merchantId)
    )
      inconsistent(['publicCheckout']);

    const savedContext = savedCardPublicRuntime.context;
    if (
      savedCardPublicRuntime.deployment !== 'staging' ||
      savedCardPublicRuntime.expiresAt !== expected.expiresAt ||
      savedCardPublicRuntime.authOrigin !== origins.auth ||
      (savedCardPublicRuntime.publicOrigin !== origins.public &&
        savedCardPublicRuntime.publicOrigin !== origins.auth) ||
      savedContext.integrationId !== scope.integrationId ||
      savedContext.merchantId !== scope.merchantId ||
      savedContext.expectedBusinessId !== scope.businessId ||
      !savedContext.allowlistedMerchantIds.includes(scope.merchantId)
    )
      inconsistent(['savedCardPublicRuntime']);

    const replay = receiverReplayRuntime.configuration;
    if (
      receiverReplayRuntime.expectedAppSystemId !== expected.systemIdentifier ||
      replay.scope.expectedSystemId !== expected.systemIdentifier ||
      replay.scope.integrationId !== scope.integrationId ||
      replay.scope.merchantId !== scope.merchantId ||
      replay.scope.treasuryBindingId !== scope.treasuryBindingId ||
      replay.scope.businessId !== scope.businessId ||
      replay.evidence.integrationId !== scope.integrationId ||
      replay.evidence.systemIdentifier !== expected.systemIdentifier ||
      replay.evidence.webhookSecret !== background.evidence.webhookSecret ||
      replay.evidence.piggyvest.expectedBusinessId !== scope.businessId ||
      replay.evidence.piggyvest.apiBaseUrl !==
        background.evidence.piggyvest.apiBaseUrl ||
      replay.evidence.piggyvest.apiSecret !==
        background.evidence.piggyvest.apiSecret ||
      replay.evidence.piggyvest.expectedCurrency !==
        background.evidence.piggyvest.expectedCurrency ||
      replay.evidence.piggyvest.timeoutMs !==
        background.evidence.piggyvest.timeoutMs ||
      replay.evidence.piggyvest.maxResponseBytes !==
        background.evidence.piggyvest.maxResponseBytes
    )
      inconsistent(['receiverReplayRuntime']);

    const secrets = [
      background.provider.paystackSecret,
      checkout.provider.paystackSecret,
      recovery.provider.paystackSecret,
    ];
    if (new Set(secrets).size !== 1)
      inconsistent(['provider', 'paystackSecret']);
    if (
      background.provider.piggyvest.apiBaseUrl !== origins.piggyvestApi ||
      background.evidence.piggyvest.apiBaseUrl !== origins.piggyvestApi ||
      checkout.provider.callbackUrl !== `${origins.public}/savings/card-return`
    )
      inconsistent(['origins']);

    const allDatabases = databases.filter(Boolean);
    for (const database of allDatabases) {
      if (
        database.transport !== 'tls' ||
        database.expectedSystemId !== expected.systemIdentifier ||
        database.database !== expected.database ||
        database.expectedDatabase !== expected.database ||
        database.port !== expected.port ||
        database.host !== expected.host ||
        database.expectedHost !== expected.host ||
        database.expectedProjectId !== expected.projectId ||
        database.actualProjectId !== expected.projectId ||
        !database.certificateAuthority
      )
        inconsistent(['database']);
    }
    const caValues = allDatabases.map((database) =>
      database.transport === 'tls' ? database.certificateAuthority : undefined
    );
    if (new Set(caValues).size !== 1)
      inconsistent(['database', 'certificateAuthority']);

    const treasuryPasswords = [
      background.database.treasury.password,
      checkout.customerDatabase.password,
      savedCardPublicRuntime.database.password,
      replay.database.treasury.password,
    ];
    const authorizerPasswords = [
      background.database.authorizer.password,
      checkout.verifierDatabase.password,
      recovery.authorizerDatabase.password,
    ];
    const evidencePasswords = [
      background.database.ingestion.password,
      replay.database.ingestion.password,
    ];
    if (
      new Set(treasuryPasswords).size !== 1 ||
      new Set(authorizerPasswords).size !== 1 ||
      new Set(evidencePasswords).size !== 1
    )
      inconsistent(['database', 'rolePasswordConsistency']);
  }
);
