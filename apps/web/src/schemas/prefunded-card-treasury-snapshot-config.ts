import { z } from 'zod';
import {
  PREFUNDED_TREASURY_SYSTEM_IDENTIFIER,
  prefundedCardTreasuryVerifierSchema,
} from './prefunded-card-treasury-verifier';

const scope = z.strictObject({
  integrationId: z.literal('d91d9e87-8e0d-44de-9b84-1e1d709633d2'),
  merchantId: z.literal('10000000-0000-4000-8000-000000000001'),
});
const verifier = prefundedCardTreasuryVerifierSchema.superRefine(
  (value, context) => {
    if (
      value.treasuryBindingId !== 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57' ||
      value.expectedBusinessId !== '01M2381RG34HQJMHQKE7DWDACR' ||
      value.sourceWalletId !== '01M238A0V75387H4HZ15YFWGX3'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Unapproved treasury snapshot scope',
      });
    }
  }
);
const bindingId = z.literal('ffffcb16-2e95-5cff-a591-e9cc81cf5f57');
const storeScope = z.strictObject({
  environment: z.literal('staging'),
  systemIdentifier: z.literal(PREFUNDED_TREASURY_SYSTEM_IDENTIFIER),
  treasuryBindingId: bindingId,
  expectedBusinessId: z.literal('01M2381RG34HQJMHQKE7DWDACR'),
  sourceWalletId: z.literal('01M238A0V75387H4HZ15YFWGX3'),
});
const snapshot = z.strictObject({
  treasuryBindingId: bindingId,
  evidenceId: z.string().regex(/^pvts_[a-f0-9]{64}$/),
  observedAt: z.iso.datetime({ precision: 3 }),
  availableKobo: z.number().int().min(0).max(10_000).safe(),
});
const verificationRows = z
  .array(z.strictObject({ result: z.string().max(32) }))
  .length(1);
const databaseTimeRows = z
  .array(z.strictObject({ result: z.date() }))
  .length(1);
const recordRows = z
  .array(z.strictObject({ result: z.enum(['recorded', 'duplicate']) }))
  .length(1);

export const prefundedCardTreasurySnapshotStoreSchemas = {
  bindingId,
  scope: storeScope,
  snapshot,
  verificationRows,
  databaseTimeRows,
  recordRows,
};

export const prefundedCardTreasurySnapshotDatabaseSchema = z
  .strictObject({
    environment: z.literal('staging'),
    transport: z.literal('tls'),
    host: z.literal('piggyvest-db.staging.baci.internal'),
    expectedHost: z.literal('piggyvest-db.staging.baci.internal'),
    port: z.literal(5432),
    login: z.literal('prefunded_snapshot_verifier'),
    expectedLogin: z.literal('prefunded_snapshot_verifier'),
    database: z.literal('postgres'),
    expectedDatabase: z.literal('postgres'),
    expectedSystemId: z.literal(PREFUNDED_TREASURY_SYSTEM_IDENTIFIER),
    certificateAuthority: z.string().min(1).max(32_768),
    password: z.string().regex(/^[A-Za-z0-9_-]{64}$/),
  })
  .refine(
    (value) =>
      value.host === value.expectedHost &&
      value.database === value.expectedDatabase,
    'Invalid staging snapshot database configuration'
  );

export const prefundedCardTreasurySnapshotConfigSchema = z
  .strictObject({
    scope,
    verifier,
    database: prefundedCardTreasurySnapshotDatabaseSchema,
  })
  .refine(
    (value) =>
      value.database.expectedSystemId === value.verifier.systemIdentifier &&
      value.database.environment === value.verifier.environment,
    'Snapshot verifier and database identity do not match'
  );

export type PrefundedCardTreasurySnapshotConfig = z.infer<
  typeof prefundedCardTreasurySnapshotConfigSchema
>;
