import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createAccrualReplay } from './replay-accrual-runtime';
import { createDurableReplayAdapters, type StoreRpc } from './replay-store';
import { key, lease } from './replay-test-fixtures';
import { createReplayWorker } from './replay-worker';

const event = {
  eventId: 'accrual-event-1',
  customer_id: '01M3N0TE6QWPFNPRGVCQG11N1P',
  eventType: 'interest-accrued.success',
  eventCategory: 'interest_accrued',
  eventData: {
    id: 'accrual-1',
    wallet_id: 'b7ff9afd-bb88-11f1-a539-42010a9c0026',
    balance: 1650000,
    percentage: 9,
    interest_date: '2026-09-28T00:00:00.000Z',
    amount: 406.8493150684931,
    interest_type: 'original',
  },
  pvb_wallet: '01M3N0TE015JJR1YKBFC2JWZJ9',
  pvb_wallet_name: 'Synthetic customer',
  pvb_split_interest_with_wallet: null,
  pvb_split_interest_with_wallet_name: null,
};

describe('durable signed accrual routing', () => {
  it.each([
    true,
    false,
  ])('uses a live-claim signature lookup before any observation write (signature present=%s)', async (present) => {
    const claimed = {
      ...lease(event as unknown as Parameters<typeof lease>[0]),
      receiptId: '60000000-0000-4000-8000-000000000001',
      claimToken: '70000000-0000-4000-8000-000000000001',
    };
    const secret = 'synthetic-signing-secret';
    const signature = createHmac('sha512', secret)
      .update(JSON.stringify(event))
      .digest('hex');
    const calls: Array<{ name: string; parameters: Record<string, unknown> }> =
      [];
    const store: StoreRpc = {
      async call<Result>(
        name: string,
        parameters: Record<string, unknown>
      ): Promise<Result> {
        calls.push({ name, parameters });
        const response =
          name === 'claim_piggyvest_staging_receipts'
            ? [
                {
                  receipt_id: claimed.receiptId,
                  payload_sha256: claimed.sealed.payloadSha256,
                  ciphertext: claimed.sealed.ciphertext,
                  nonce: claimed.sealed.nonce,
                  auth_tag: claimed.sealed.authTag,
                  key_version: 'staging-v1',
                  claim_token: claimed.claimToken,
                  attempts: 1,
                },
              ]
            : name === 'read_piggyvest_staging_receipt_signature'
              ? present
                ? {
                    receiptId: claimed.receiptId,
                    payloadSha256: claimed.sealed.payloadSha256,
                    signature,
                  }
                : null
              : true;
        return response as Result;
      },
    };
    const execute = vi.fn(async () => ({ rows: [{ result: 'applied' }] }));
    const app = { rpc: vi.fn() };
    const adapters = createDurableReplayAdapters({
      store,
      app: app as unknown as SupabaseClient,
      keyResolver: async () => key,
      leaseSeconds: 300,
      accrualReplay: createAccrualReplay(
        {
          integrationId: '40000000-0000-4000-8000-000000000001',
          businessId: 'business',
          expectedSystemId: '7685292944002592802',
        },
        secret,
        execute
      ),
    });
    const result = await createReplayWorker(adapters, {
      environment: 'staging',
      batchSize: 1,
      keyResolver: async () => key,
    }).run();
    expect(calls[1]).toEqual({
      name: 'read_piggyvest_staging_receipt_signature',
      parameters: {
        p_receipt_id: claimed.receiptId,
        p_payload_sha256: claimed.sealed.payloadSha256,
        p_claim_token: claimed.claimToken,
      },
    });
    expect(app.rpc).not.toHaveBeenCalled();
    if (present) {
      expect(result.processed).toBe(1);
      expect(execute).toHaveBeenCalledOnce();
      expect(calls.at(-1)?.parameters.p_status).toBe('processed');
    } else {
      expect(result.retryable).toBe(1);
      expect(execute).not.toHaveBeenCalled();
      expect(calls.at(-1)?.parameters).toMatchObject({
        p_status: 'quarantined',
        p_last_error: 'worker retryable',
      });
    }
  });
});
