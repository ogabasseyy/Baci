import 'server-only';
import { createHash } from 'node:crypto';
import type { PiggyvestStagingWalletResponse } from '@/schemas/piggyvest-staging-wallet';
import {
  type PrefundedCardTreasuryVerifierConfiguration,
  prefundedCardTreasuryVerifierSchema,
} from '@/schemas/prefunded-card-treasury-verifier';
import {
  PiggyvestStagingWalletRetrievalError,
  retrievePiggyvestStagingWallet,
} from './read-only-client';

const MAX_SAFE_KOBO = Number.MAX_SAFE_INTEGER;
const MAX_CLOCK_SKEW_MS = 30_000;
const MAX_DATABASE_TIME_READ_MS = 2_000;

export type PrefundedTreasurySnapshotInput = {
  treasuryBindingId: string;
  evidenceId: string;
  observedAt: string;
  availableKobo: number;
};

export type PrefundedTreasurySnapshotStore = {
  verifyTreasuryBinding(input: {
    environment: 'staging';
    systemIdentifier: string;
    treasuryBindingId: string;
    expectedBusinessId: string;
    sourceWalletId: string;
  }): Promise<unknown>;
  readDatabaseTime(treasuryBindingId: string): Promise<unknown>;
  recordImmutableSnapshotWithDatabaseAssignedSequence(
    input: PrefundedTreasurySnapshotInput
  ): Promise<unknown>;
};

export type PrefundedTreasuryVerificationResult =
  | { outcome: 'recorded' | 'duplicate'; evidenceId: string }
  | {
      outcome: 'refused';
      reason:
        | 'invalid_configuration'
        | 'expired'
        | 'provider_unavailable'
        | 'provider_identity_mismatch'
        | 'treasury_binding_unverified'
        | 'invalid_balance'
        | 'stale_clock'
        | 'snapshot_store_unavailable';
    };

function safeDate(value: unknown): number | null {
  const time = value instanceof Date ? value.getTime() : Number.NaN;
  return Number.isFinite(time) ? time : null;
}

function readClock(now: () => Date): number | null {
  try {
    return safeDate(now());
  } catch {
    return null;
  }
}

function evidenceId(input: {
  treasuryBindingId: string;
  businessId: string;
  sourceWalletId: string;
  observedAt: string;
  availableKobo: number;
}): string {
  const stableEvidence = JSON.stringify([
    input.treasuryBindingId,
    input.businessId,
    input.sourceWalletId,
    input.observedAt,
    input.availableKobo,
  ]);
  return `pvts_${createHash('sha256').update(stableEvidence).digest('hex')}`;
}

export async function verifyPrefundedCardTreasurySnapshot({
  configuration: rawConfiguration,
  store,
  fetchImplementation,
  now = () => new Date(),
}: {
  configuration: unknown;
  store: PrefundedTreasurySnapshotStore;
  fetchImplementation: typeof fetch;
  now?: () => Date;
}): Promise<PrefundedTreasuryVerificationResult> {
  const parsed =
    prefundedCardTreasuryVerifierSchema.safeParse(rawConfiguration);
  if (!parsed.success)
    return { outcome: 'refused', reason: 'invalid_configuration' };
  const configuration: PrefundedCardTreasuryVerifierConfiguration = parsed.data;
  const deadline = Date.parse(configuration.expiresAt);
  const startedAt = readClock(now);
  if (startedAt === null) {
    return { outcome: 'refused', reason: 'stale_clock' };
  }
  if (startedAt >= deadline) {
    return { outcome: 'refused', reason: 'expired' };
  }

  try {
    const binding = await store.verifyTreasuryBinding({
      environment: configuration.environment,
      systemIdentifier: configuration.systemIdentifier,
      treasuryBindingId: configuration.treasuryBindingId,
      expectedBusinessId: configuration.expectedBusinessId,
      sourceWalletId: configuration.sourceWalletId,
    });
    if (binding !== 'verified') {
      return { outcome: 'refused', reason: 'treasury_binding_unverified' };
    }
  } catch {
    return { outcome: 'refused', reason: 'snapshot_store_unavailable' };
  }

  let wallet: PiggyvestStagingWalletResponse;
  try {
    wallet = await retrievePiggyvestStagingWallet({
      configuration: configuration.piggyvest,
      walletId: configuration.sourceWalletId,
      fetchImplementation,
    });
  } catch (error) {
    if (
      error instanceof PiggyvestStagingWalletRetrievalError &&
      [
        'BUSINESS_ID_MISMATCH',
        'CURRENCY_MISMATCH',
        'WALLET_ID_MISMATCH',
      ].includes(error.code)
    ) {
      return { outcome: 'refused', reason: 'provider_identity_mismatch' };
    }
    return { outcome: 'refused', reason: 'provider_unavailable' };
  }

  if (
    wallet.data.id !== configuration.sourceWalletId ||
    wallet.data.business_id !== configuration.expectedBusinessId ||
    wallet.data.currency !== 'NGN'
  ) {
    return { outcome: 'refused', reason: 'provider_identity_mismatch' };
  }
  if (
    !Number.isSafeInteger(wallet.data.balance) ||
    wallet.data.balance < 0 ||
    wallet.data.balance > MAX_SAFE_KOBO
  ) {
    return { outcome: 'refused', reason: 'invalid_balance' };
  }

  const finishedAt = readClock(now);
  if (finishedAt === null || finishedAt < startedAt) {
    return { outcome: 'refused', reason: 'stale_clock' };
  }
  if (finishedAt >= deadline) {
    return { outcome: 'refused', reason: 'expired' };
  }

  const databaseReadStartedAt = readClock(now);
  if (databaseReadStartedAt === null || databaseReadStartedAt < finishedAt) {
    return { outcome: 'refused', reason: 'stale_clock' };
  }
  if (databaseReadStartedAt >= deadline) {
    return { outcome: 'refused', reason: 'expired' };
  }

  let databaseTime: unknown;
  let databaseReadTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      databaseReadTimeout = setTimeout(
        () => reject(new Error('DATABASE_TIME_READ_TIMEOUT')),
        MAX_DATABASE_TIME_READ_MS
      );
    });
    databaseTime = await Promise.race([
      store.readDatabaseTime(configuration.treasuryBindingId),
      timeout,
    ]);
  } catch {
    return { outcome: 'refused', reason: 'snapshot_store_unavailable' };
  } finally {
    if (databaseReadTimeout !== undefined) clearTimeout(databaseReadTimeout);
  }
  const databaseReadFinishedAt = readClock(now);
  if (
    databaseReadFinishedAt === null ||
    databaseReadFinishedAt < databaseReadStartedAt ||
    databaseReadFinishedAt - databaseReadStartedAt > MAX_DATABASE_TIME_READ_MS
  ) {
    return { outcome: 'refused', reason: 'stale_clock' };
  }
  if (databaseReadFinishedAt >= deadline) {
    return { outcome: 'refused', reason: 'expired' };
  }
  const databaseTimeMs = safeDate(databaseTime);
  if (
    databaseTimeMs === null ||
    databaseTimeMs >= deadline ||
    Math.abs(databaseTimeMs - finishedAt) > MAX_CLOCK_SKEW_MS
  ) {
    return { outcome: 'refused', reason: 'stale_clock' };
  }

  const observedAt = new Date(databaseTimeMs).toISOString();
  const snapshot = {
    treasuryBindingId: configuration.treasuryBindingId,
    businessId: configuration.expectedBusinessId,
    sourceWalletId: configuration.sourceWalletId,
    observedAt,
    availableKobo: wallet.data.balance,
  };
  const id = evidenceId(snapshot);
  const beforeRecordAt = readClock(now);
  if (
    beforeRecordAt === null ||
    beforeRecordAt < databaseReadFinishedAt ||
    beforeRecordAt < startedAt
  ) {
    return { outcome: 'refused', reason: 'stale_clock' };
  }
  if (beforeRecordAt >= deadline) {
    return { outcome: 'refused', reason: 'expired' };
  }
  if (Math.abs(databaseTimeMs - beforeRecordAt) > MAX_CLOCK_SKEW_MS) {
    return { outcome: 'refused', reason: 'stale_clock' };
  }
  try {
    const outcome =
      await store.recordImmutableSnapshotWithDatabaseAssignedSequence({
        treasuryBindingId: snapshot.treasuryBindingId,
        evidenceId: id,
        observedAt,
        availableKobo: snapshot.availableKobo,
      });
    if (outcome === 'recorded' || outcome === 'duplicate') {
      return { outcome, evidenceId: id };
    }
    return { outcome: 'refused', reason: 'snapshot_store_unavailable' };
  } catch {
    return { outcome: 'refused', reason: 'snapshot_store_unavailable' };
  }
}
