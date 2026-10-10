import { z } from 'zod';

const fingerprint = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .nullable();
const identity = z.string().uuid().nullable();
export const AcceptanceEvidenceSchema = z
  .object({
    observedAt: z.string().datetime().nullable(),
    project: z
      .object({
        authenticated: z.boolean(),
        ownerApproved: z.boolean(),
        projectId: identity,
        inventorySha256: fingerprint,
        signingApproved: z.boolean(),
      })
      .strict(),
    build: z
      .object({
        platform: z.enum(['ios', 'android']).nullable(),
        buildId: identity,
        projectId: identity,
        manifestSha256: fingerprint,
        artifactSha256: fingerprint,
        nativeGeneratedFromStaging: z.boolean(),
        pushCredentialsMatchStaging: z.boolean(),
      })
      .strict(),
    device: z
      .object({
        physical: z.boolean(),
        platform: z.enum(['ios', 'android']).nullable(),
        applicationId: z.string().min(1).nullable(),
        installedBuildId: identity,
        permissionGranted: z.boolean(),
        tokenRegisteredToStaging: z.boolean(),
        registrationEvidenceSha256: fingerprint,
      })
      .strict(),
    delivery: z
      .object({
        foreground: z.boolean(),
        background: z.boolean(),
        coldStartTap: z.boolean(),
        matchingGoalOpened: z.boolean(),
        scopedWalletQueryRefreshed: z.boolean(),
        receiptEvidenceSha256: fingerprint,
      })
      .strict(),
    interest: z
      .object({
        providerPaidReceiptVerified: z.boolean(),
        netAmountKobo: z.number().int().positive().nullable(),
        paidNetCopyVerified: z.boolean(),
        earningsAndGoalRefreshed: z.boolean(),
        duplicateCreditAbsent: z.boolean(),
        receiptEvidenceSha256: fingerprint,
      })
      .strict(),
    sample: z
      .object({
        nonProviderLabelVisible: z.boolean(),
        persistedBalancesUnchanged: z.boolean(),
      })
      .strict(),
    protectedState: z
      .object({
        principalKobo: z.literal(10000),
        approvedPrefundingKobo: z.literal(10000),
        financialReplayEnabled: z.literal(false),
        backgroundEnabled: z.literal(false),
        snapshotEnabled: z.literal(false),
        checkoutGetStatus: z.literal(200),
        checkoutEnabled: z.literal(false),
        checkoutMaximumKobo: z.literal(0),
        checkoutPostStatus: z.literal(503),
        checkoutPatchStatus: z.literal(503),
      })
      .strict(),
  })
  .strict();
