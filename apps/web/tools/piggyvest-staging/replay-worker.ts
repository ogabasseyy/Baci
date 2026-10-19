import type { ReplayBatchResult } from './replay-batch-result';
import {
  decryptAndValidateReceipt,
  type ReplayEvent,
  ReplayValidationError,
} from './replay-crypto';
import type { ReplayLease } from './replay-lease';
import {
  dispatchPrefundedReceipt,
  type PrefundedReceiptReplay,
} from './replay-prefunded';
import type { TrustedMapping } from './replay-trusted-mapping';
import { replayWorkerSchemas } from './schemas/replay-worker';

export type { ReplayBatchResult } from './replay-batch-result';
export type { ReplayLease } from './replay-lease';
export type { TrustedMapping } from './replay-trusted-mapping';

export type MappingResolution =
  | { status: 'matched'; mapping: TrustedMapping }
  | { status: 'unmapped' }
  | { status: 'ambiguous' }
  | { status: 'storage-error' };

export type ReplayAdapters = {
  prefundedReplay?: PrefundedReceiptReplay;
  dispatchAccrual?(input: {
    lease: ReplayLease;
    raw: Buffer;
  }): Promise<'applied' | 'duplicate'>;
  claimBatch(input: { limit: number }): Promise<readonly ReplayLease[]>;
  resolveMapping(input: {
    providerCustomerId: string;
    pvbWallet: string;
  }): Promise<MappingResolution>;
  dispatch(input: {
    lease: ReplayLease;
    event: ReplayEvent;
    mapping: TrustedMapping;
  }): Promise<'applied' | 'duplicate'>;
  dispatchFinancial?(input: {
    lease: ReplayLease;
    event: ReplayEvent;
  }): Promise<'applied' | 'duplicate'>;
  quarantine(input: {
    receiptId: string;
    eventId: string | null;
    claimToken: string;
    reason: string;
  }): Promise<void>;
  resolve(input: {
    receiptId: string;
    claimToken: string;
    status: 'processed' | 'retryable' | 'quarantined';
    reason: string;
  }): Promise<void>;
};

/**
 * Thrown by the dispatch adapter when the event must be quarantined
 * rather than resolved: poison (invalid/inconsistent), ambiguous
 * attribution, or unsupported shape. The worker routes these to the
 * fenced quarantine adapter instead of the retryable path. This exists
 * because the generic processor's `processed` return is not proof of
 * credit: it also returns `processed` after poison failures that resolve
 * as failed with no financial effect.
 */
export class DispatchQuarantine extends Error {
  readonly eventId: string | undefined;
  readonly reason: string;

  constructor(input: { eventId?: string; reason: string }) {
    super(`Replay dispatch quarantined: ${input.reason}`);
    this.name = 'DispatchQuarantine';
    this.eventId = input.eventId;
    this.reason = input.reason;
  }
}

export function createReplayWorker(
  adapters: ReplayAdapters,
  config: {
    environment: string;
    batchSize: number;
    keyResolver: (keyVersion: 'staging-v1') => Promise<Buffer | null>;
  }
) {
  const parsed = replayWorkerSchemas.configuration.safeParse(config);
  if (!parsed.success || typeof config.keyResolver !== 'function') {
    throw new Error('Invalid staging replay configuration');
  }

  async function resolve(
    lease: ReplayLease,
    status: 'processed' | 'retryable' | 'quarantined',
    reason: string
  ): Promise<boolean> {
    try {
      await adapters.resolve({
        receiptId: lease.receiptId,
        claimToken: lease.claimToken,
        status,
        reason,
      });
      return true;
    } catch {
      return false;
    }
  }

  async function quarantine(
    lease: ReplayLease,
    reason: string,
    eventId?: string
  ): Promise<boolean> {
    try {
      await adapters.quarantine({
        receiptId: lease.receiptId,
        eventId: eventId ?? lease.eventId,
        claimToken: lease.claimToken,
        reason,
      });
    } catch {
      return false;
    }
    return true;
  }

  async function processLease(
    lease: ReplayLease,
    result: ReplayBatchResult
  ): Promise<void> {
    let key: Buffer | null;
    try {
      key = await config.keyResolver(lease.sealed.keyVersion);
    } catch {
      if (await resolve(lease, 'retryable', 'key-resolution-failed'))
        result.retryable += 1;
      else result.resolutionFailures += 1;
      return;
    }
    if (!key) {
      if (await resolve(lease, 'retryable', 'key-unavailable'))
        result.retryable += 1;
      else result.resolutionFailures += 1;
      return;
    }
    let decoded: ReturnType<typeof decryptAndValidateReceipt>;
    try {
      decoded = decryptAndValidateReceipt(lease.sealed, key, lease.eventId);
    } catch (error) {
      const reason =
        error instanceof ReplayValidationError
          ? error.reason
          : 'invalid-receipt';
      if (await quarantine(lease, reason)) result.quarantined += 1;
      else result.resolutionFailures += 1;
      return;
    }
    if (decoded.event.eventType === 'interest-accrued.success') {
      await finishDispatch(lease, result, () => {
        if (!adapters.dispatchAccrual)
          throw new Error('Interest accrual replay unavailable');
        return adapters.dispatchAccrual({ lease, raw: decoded.raw });
      });
      return;
    }
    const prefunded = adapters.prefundedReplay;
    if (prefunded) {
      let legacy = false;
      await finishDispatch(
        lease,
        result,
        async () => {
          const outcome = await dispatchPrefundedReceipt(
            prefunded,
            lease,
            decoded
          );
          legacy = outcome === null;
          return outcome;
        },
        true
      );
      if (!legacy) return;
    }
    if (decoded.event.eventType !== 'bank-transfer.inflow.success') {
      await finishDispatch(lease, result, () => {
        if (!adapters.dispatchFinancial)
          throw new Error('Financial replay unavailable');
        return adapters.dispatchFinancial({ lease, event: decoded.event });
      });
      return;
    }
    let mappingResult: unknown;
    try {
      mappingResult = await adapters.resolveMapping({
        providerCustomerId: decoded.event.customer_id,
        pvbWallet: decoded.event.pvb_wallet,
      });
    } catch {
      if (await resolve(lease, 'retryable', 'mapping-resolution-failed'))
        result.retryable += 1;
      else result.resolutionFailures += 1;
      return;
    }
    const mappingParsed = replayWorkerSchemas.mapping.safeParse(mappingResult);
    if (!mappingParsed.success) {
      if (await resolve(lease, 'retryable', 'invalid-mapping-result'))
        result.retryable += 1;
      else result.resolutionFailures += 1;
      return;
    }
    const mapping: MappingResolution = mappingParsed.data;
    if (mapping.status === 'unmapped' || mapping.status === 'storage-error') {
      const reason =
        mapping.status === 'unmapped'
          ? 'mapping-unavailable'
          : 'mapping-storage-error';
      if (await resolve(lease, 'retryable', reason)) result.retryable += 1;
      else result.resolutionFailures += 1;
      return;
    }
    if (
      mapping.status === 'ambiguous' ||
      mapping.mapping.providerCustomerId !== decoded.event.customer_id ||
      mapping.mapping.pvbWallet !== decoded.event.pvb_wallet
    ) {
      if (await quarantine(lease, 'mapping-mismatch')) result.quarantined += 1;
      else result.resolutionFailures += 1;
      return;
    }
    await finishDispatch(lease, result, () =>
      adapters.dispatch({
        lease,
        event: decoded.event,
        mapping: mapping.mapping,
      })
    );
  }

  async function finishDispatch(
    lease: ReplayLease,
    result: ReplayBatchResult,
    dispatch: () => Promise<'applied' | 'duplicate' | null>,
    allowLegacy = false
  ): Promise<void> {
    try {
      const outcome = await dispatch();
      if (outcome === null && allowLegacy) return;
      if (outcome !== 'applied' && outcome !== 'duplicate') {
        if (await resolve(lease, 'retryable', 'invalid-dispatch-outcome'))
          result.retryable += 1;
        else result.resolutionFailures += 1;
        return;
      }
      if (
        await resolve(
          lease,
          'processed',
          outcome === 'duplicate' ? 'duplicate' : 'applied'
        )
      )
        result.processed += 1;
      else result.resolutionFailures += 1;
    } catch (error) {
      if (error instanceof DispatchQuarantine) {
        if (await quarantine(lease, error.reason, error.eventId))
          result.quarantined += 1;
        else result.resolutionFailures += 1;
        return;
      }
      if (await resolve(lease, 'retryable', 'dispatch-failed'))
        result.retryable += 1;
      else result.resolutionFailures += 1;
    }
  }

  return {
    async run(): Promise<ReplayBatchResult> {
      const leases = await adapters.claimBatch({
        limit: parsed.data.batchSize,
      });
      if (leases.length > parsed.data.batchSize) {
        throw new Error('Replay claim exceeded configured bound');
      }
      const result: ReplayBatchResult = {
        claimed: leases.length,
        processed: 0,
        retryable: 0,
        quarantined: 0,
        resolutionFailures: 0,
      };
      for (const lease of leases) await processLease(lease, result);
      return result;
    },
  };
}
