import type { SupabaseClient } from '@supabase/supabase-js';
import z from 'zod';
import type { createAccrualReplay } from './replay-accrual-runtime';
import {
  dispatchReplayInflow,
  isReplayInflowEvent,
} from './replay-inflow-dispatch';
import { createReplaySignatureReader } from './replay-signature-reader';
import {
  DispatchQuarantine,
  type ReplayAdapters,
  type ReplayLease,
} from './replay-worker';

/**
 * Durable backing for Luna's replay worker (staging-only).
 *
 * Shape notes (verified against replay-worker.ts, not the review doc):
 * - claimBatch returns sealed leases WITHOUT decrypting: decryption
 *   happens in the worker, which binds the expected event id when the
 *   lease carries one. Bulk claims carry eventId '' (unknown until
 *   decrypt); the worker skips binding for those.
 * - Claim tokens travel inside leases, so quarantine/resolve fence on
 *   the caller-supplied token. No token map is kept here.
 * - Mapping is exact (provider customer, pvb_wallet). A wallet row with
 *   a different customer is 'ambiguous' (quarantine), never 'unmapped':
 *   retries cannot fix conflicting attribution.
 * - dispatch returns 'applied' only after the inflow recognition RPC reports
 *   'recognized', and 'duplicate' only after it reports 'duplicate'.
 *   Poison, conflicts, and unsupported shapes throw DispatchQuarantine;
 *   retryable RPC errors rethrow for the retryable path.
 *
 * No client is constructed and no secret is read in this module.
 */

export interface StoreRpc {
  call<T>(fn: string, params: Record<string, unknown>): Promise<T>;
}

export function createSupabaseRpc(client: SupabaseClient): StoreRpc {
  return {
    async call<T>(fn: string, params: Record<string, unknown>): Promise<T> {
      const { data, error } = await client.rpc(fn, params);
      if (error) {
        throw Object.assign(
          new Error(`Replay store RPC ${fn} failed: ${error.message}`),
          { code: error.code }
        );
      }
      return data as T;
    },
  };
}

const claimRowSchema = z.object({
  receipt_id: z.string().min(1),
  payload_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  ciphertext: z.string().min(1),
  nonce: z.string().min(1),
  auth_tag: z.string().min(1),
  key_version: z.literal('staging-v1'),
  claim_token: z.string().min(1),
  attempts: z.number().int().nonnegative(),
});

const mappingRowSchema = z.object({
  customer_id: z.string().min(1),
  merchant_id: z.string().min(1),
  provider_customer_id: z.string().min(1),
  provider_wallet_id: z.string().min(1),
});

// Reasons the worker may send to quarantine: the durable RPC allowlist
// plus the worker's own sanitized reason strings. Anything else throws
// instead of being silently remapped.
const QUARANTINE_REASONS = new Set([
  'unmapped',
  'ambiguous',
  'conflict',
  'poison',
  'unsupported',
  'undecryptable',
  'mapping-mismatch',
  'authentication-failed',
  'customer-mismatch',
  'digest-mismatch',
  'event-id-mismatch',
  'invalid-event',
  'invalid-json',
  'invalid-utf8',
  'invalid-receipt',
  'unstable-event-id',
  'unsupported-event',
]);

export interface DurableReplayAdapterInput {
  allowLegacyInflow?: boolean;
  accrualReplay?: ReturnType<typeof createAccrualReplay>;
  prefundedReplay?: ReplayAdapters['prefundedReplay'];
  dispatchFinancial?: ReplayAdapters['dispatchFinancial'];
  store: StoreRpc;
  app: SupabaseClient;
  keyResolver: (keyVersion: 'staging-v1') => Promise<Buffer | null>;
  leaseSeconds: number;
}

export function createDurableReplayAdapters(
  input: DurableReplayAdapterInput
): ReplayAdapters {
  if (input.allowLegacyInflow === false && input.prefundedReplay)
    throw new Error('Prefunded replay requires bank-inflow authority');
  const accrualReplay = input.accrualReplay;
  const readOriginalSignature = createReplaySignatureReader(input.store);
  return {
    dispatchAccrual: accrualReplay
      ? (receipt) =>
          accrualReplay({
            ...receipt,
            readOriginalSignature,
          })
      : undefined,
    prefundedReplay: input.prefundedReplay
      ? {
          ...input.prefundedReplay,
          readOriginalSignature:
            input.prefundedReplay.readOriginalSignature ??
            createReplaySignatureReader(input.store),
        }
      : undefined,
    dispatchFinancial: input.dispatchFinancial,
    async claimBatch({ limit }): Promise<readonly ReplayLease[]> {
      const rows = await input.store.call<unknown[]>(
        'claim_piggyvest_staging_receipts',
        { p_limit: limit, p_lease_seconds: input.leaseSeconds }
      );
      const leases: ReplayLease[] = [];
      for (const row of rows ?? []) {
        const parsed = claimRowSchema.safeParse(row);
        if (!parsed.success) throw new Error('Replay claim schema mismatch');
        const sealed = {
          payloadSha256: parsed.data.payload_sha256,
          ciphertext: parsed.data.ciphertext,
          nonce: parsed.data.nonce,
          authTag: parsed.data.auth_tag,
          keyVersion: 'staging-v1' as const,
        };
        leases.push({
          receiptId: parsed.data.receipt_id,
          eventId: null,
          claimToken: parsed.data.claim_token,
          sealed,
        });
      }
      return leases;
    },

    async resolveMapping({ providerCustomerId, pvbWallet }) {
      if (input.allowLegacyInflow === false)
        throw new Error('Legacy inflow replay disabled');
      const data = await createSupabaseRpc(input.app).call<unknown>(
        'resolve_piggyvest_staging_goal_mapping',
        {
          p_provider_customer_id: providerCustomerId,
          p_wallet_id: pvbWallet,
        }
      );
      if (!Array.isArray(data)) {
        throw new Error('Replay mapping RPC schema mismatch');
      }
      if (data.length > 1) return { status: 'ambiguous' as const };
      if (data.length === 0) return { status: 'unmapped' as const };
      const row = mappingRowSchema.safeParse(data[0]);
      if (!row.success) {
        throw new Error('Replay mapping record is invalid');
      }
      if (row.data.provider_customer_id !== providerCustomerId) {
        return { status: 'ambiguous' as const };
      }
      if (row.data.provider_wallet_id !== pvbWallet) {
        return { status: 'ambiguous' as const };
      }
      return {
        status: 'matched' as const,
        mapping: {
          merchantId: row.data.merchant_id,
          customerId: row.data.customer_id,
          providerCustomerId: row.data.provider_customer_id,
          pvbWallet: row.data.provider_wallet_id,
        },
      };
    },

    async dispatch({ event }) {
      if (input.allowLegacyInflow === false)
        throw new Error('Legacy inflow replay disabled');
      if (isReplayInflowEvent(event)) {
        return await dispatchReplayInflow(createSupabaseRpc(input.app), event);
      }
      throw new DispatchQuarantine({
        eventId: event.eventId,
        reason: 'unsupported',
      });
    },

    async quarantine({
      receiptId,
      eventId,
      claimToken,
      reason,
    }): Promise<void> {
      if (!QUARANTINE_REASONS.has(reason)) {
        throw new Error(`Unsupported quarantine reason: ${reason}`);
      }
      const quarantined = await input.store.call<boolean>(
        'quarantine_piggyvest_staging_receipt',
        {
          p_receipt_id: receiptId,
          p_claim_token: claimToken,
          p_event_id: eventId || null,
          p_reason: reason,
          p_detail: null,
        }
      );
      if (quarantined !== true)
        throw new Error('Replay lease transition refused');
    },

    async resolve({ receiptId, claimToken, status }): Promise<void> {
      const mapped =
        status === 'processed' ? 'processed' : ('quarantined' as const);
      const resolved = await input.store.call<boolean>(
        'resolve_piggyvest_staging_receipt',
        {
          p_receipt_id: receiptId,
          p_claim_token: claimToken,
          p_status: mapped,
          p_last_error: status === 'retryable' ? 'worker retryable' : null,
        }
      );
      if (resolved !== true) throw new Error('Replay lease transition refused');
    },
  };
}
