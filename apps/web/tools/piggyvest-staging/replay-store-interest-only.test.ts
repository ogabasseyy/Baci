import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { decryptSealedReceipt } from './replay-crypto';
import {
  createDurableReplayAdapters,
  type DurableReplayAdapterInput,
  type StoreRpc,
} from './replay-store';
import { event, key, lease } from './replay-test-fixtures';
import { createReplayWorker } from './replay-worker';

function configuredAdapters(
  allowLegacyInflow: boolean,
  prefundedReplay?: DurableReplayAdapterInput['prefundedReplay']
) {
  const claimed = lease();
  const receiptCall = vi.fn(async (name: string) => {
    if (name === 'claim_piggyvest_staging_receipts') {
      return [
        {
          receipt_id: claimed.receiptId,
          payload_sha256: claimed.sealed.payloadSha256,
          ciphertext: claimed.sealed.ciphertext,
          nonce: claimed.sealed.nonce,
          auth_tag: claimed.sealed.authTag,
          key_version: claimed.sealed.keyVersion,
          claim_token: claimed.claimToken,
          attempts: 1,
        },
      ];
    }
    return true;
  });
  const appCall = vi.fn(async (name: string) => ({
    error: null,
    data:
      name === 'recognize_piggyvest_staging_inflow'
        ? 'recognized'
        : [
            {
              merchant_id: 'merchant-001',
              customer_id: 'customer-001',
              provider_customer_id: event.customer_id,
              provider_wallet_id: event.pvb_wallet,
            },
          ],
  }));
  const store: StoreRpc = {
    async call<Result>(name: string): Promise<Result> {
      return (await receiptCall(name)) as Result;
    },
  };
  const input = {
    allowLegacyInflow,
    prefundedReplay,
    store,
    app: { rpc: appCall } as unknown as SupabaseClient,
    keyResolver: async () => key,
    leaseSeconds: 300,
  };
  return { adapters: createDurableReplayAdapters(input), appCall, receiptCall };
}

it('defers a bank receipt without any app RPC in paid-interest-only replay', async () => {
  const { adapters, appCall } = configuredAdapters(false);
  const worker = createReplayWorker(adapters, {
    environment: 'staging',
    batchSize: 10,
    keyResolver: async () => key,
  });

  const result = await worker.run();

  expect(result.retryable).toBe(1);
  expect(result.processed).toBe(0);
  expect(appCall).not.toHaveBeenCalled();
});

it('rejects direct bank dispatch before an app RPC when inflows are disabled', async () => {
  const { adapters, appCall } = configuredAdapters(false);

  await expect(
    adapters.dispatch({
      lease: lease(),
      event: decryptSealedReceipt(lease().sealed, key).event,
      mapping: {
        merchantId: 'merchant-001',
        customerId: 'customer-001',
        providerCustomerId: event.customer_id,
        pvbWallet: event.pvb_wallet,
      },
    })
  ).rejects.toThrow('Legacy inflow replay disabled');

  expect(appCall).not.toHaveBeenCalled();
});

it('refuses injected prefunded callbacks when bank-inflow authority is disabled', () => {
  const prefundedReplay = {
    resolveEnrollment: vi.fn(async () => 'enrolled' as const),
    replay: vi.fn(async () => ({
      outcome: 'retry' as const,
      stage: 'evidence',
    })),
  };

  expect(() => configuredAdapters(false, prefundedReplay)).toThrow(
    'Prefunded replay requires bank-inflow authority'
  );
  expect(prefundedReplay.resolveEnrollment).not.toHaveBeenCalled();
  expect(prefundedReplay.replay).not.toHaveBeenCalled();
});

it('preserves explicit legacy bank replay outside paid-interest-only mode', async () => {
  const { adapters, appCall } = configuredAdapters(true);
  const worker = createReplayWorker(adapters, {
    environment: 'staging',
    batchSize: 10,
    keyResolver: async () => key,
  });

  const result = await worker.run();

  expect(result.processed).toBe(1);
  expect(appCall).toHaveBeenCalledWith(
    'recognize_piggyvest_staging_inflow',
    expect.objectContaining({ p_amount_kobo: 10000 })
  );
});
