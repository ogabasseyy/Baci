import { afterEach, expect, it, vi } from 'vitest';

const clients = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: clients.create }));

import { runReplayPass } from './replay-run';
import { key, lease } from './replay-test-fixtures';

afterEach(() => vi.restoreAllMocks());

it('connects the injected evidence callback through the real pass, store and worker without a legacy credit RPC', async () => {
  const receipt = lease();
  const receiptRpc = vi.fn(async (name: string) => ({
    data:
      name === 'piggyvest_staging_system_id'
        ? '12345'
        : name === 'claim_piggyvest_staging_receipts'
          ? [
              {
                receipt_id: receipt.receiptId,
                payload_sha256: receipt.sealed.payloadSha256,
                ciphertext: receipt.sealed.ciphertext,
                nonce: receipt.sealed.nonce,
                auth_tag: receipt.sealed.authTag,
                key_version: receipt.sealed.keyVersion,
                claim_token: receipt.claimToken,
                attempts: 1,
              },
            ]
          : true,
    error: null,
  }));
  const appRpc = vi.fn(async () => ({ data: '67890', error: null }));
  clients.create.mockImplementation((url: string) => ({
    rpc: url.includes(':4792') ? receiptRpc : appRpc,
  }));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const replay = vi.fn(async () => ({
    outcome: 'processed',
    projection: 'duplicate',
  }));
  const result = await runReplayPass({
    argv: ['--limit', '1', '--max-receipts', '1'],
    env: {
      NODE_ENV: 'development',
      PVB_STAGING_REPLAY_ENABLED: '1',
      PVB_STAGING_POSTGREST_URL: 'http://127.0.0.1:4792',
      PVB_STAGING_APP_URL: 'http://127.0.0.1:4793',
      PVB_STAGING_WORKER_JWT: 'synthetic-receipt-token',
      PVB_STAGING_APP_KEY: 'synthetic-app-token',
      PVB_STAGING_RECEIPT_KEY_B64: key.toString('base64'),
      PVB_STAGING_EXPECTED_SYSTEM_ID: '12345',
      PVB_STAGING_EXPECTED_APP_SYSTEM_ID: '67890',
    },
    prefundedReplay: {
      resolveEnrollment: async () => 'enrolled',
      readOriginalSignature: async () => ({
        receiptId: receipt.receiptId,
        payloadSha256: receipt.sealed.payloadSha256,
        signature: 'a'.repeat(128),
      }),
      replay,
    },
  });
  expect(result).toMatchObject({
    claimed: 1,
    processed: 1,
    retryable: 0,
    resolutionFailures: 0,
  });
  expect(replay).toHaveBeenCalledOnce();
  expect(appRpc).toHaveBeenCalledExactlyOnceWith('piggyvest_staging_system_id');
  expect(receiptRpc).toHaveBeenLastCalledWith(
    'resolve_piggyvest_staging_receipt',
    {
      p_receipt_id: receipt.receiptId,
      p_claim_token: receipt.claimToken,
      p_status: 'processed',
      p_last_error: null,
    }
  );
});

it('carries paid-interest-only mode through the real pass without a bank credit RPC', async () => {
  const receipt = lease();
  const receiptRpc = vi.fn(async (name: string) => ({
    data:
      name === 'piggyvest_staging_system_id'
        ? '12345'
        : name === 'claim_piggyvest_staging_receipts'
          ? [
              {
                receipt_id: receipt.receiptId,
                payload_sha256: receipt.sealed.payloadSha256,
                ciphertext: receipt.sealed.ciphertext,
                nonce: receipt.sealed.nonce,
                auth_tag: receipt.sealed.authTag,
                key_version: receipt.sealed.keyVersion,
                claim_token: receipt.claimToken,
                attempts: 1,
              },
            ]
          : true,
    error: null,
  }));
  const appRpc = vi.fn(async (name: string) => ({
    data:
      name === 'piggyvest_staging_system_id'
        ? '67890'
        : name === 'recognize_piggyvest_staging_inflow'
          ? 'recognized'
          : [
              {
                merchant_id: 'merchant-001',
                customer_id: 'customer-001',
                provider_customer_id: 'provider-customer-001',
                provider_wallet_id: 'api-wallet-001',
              },
            ],
    error: null,
  }));
  clients.create.mockImplementation((url: string) => ({
    rpc: url.includes(':4792') ? receiptRpc : appRpc,
  }));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);

  const result = await runReplayPass({
    allowLegacyInflow: false,
    argv: ['--limit', '1', '--max-receipts', '1'],
    env: {
      NODE_ENV: 'development',
      PVB_STAGING_REPLAY_ENABLED: '1',
      PVB_STAGING_POSTGREST_URL: 'http://127.0.0.1:4792',
      PVB_STAGING_APP_URL: 'http://127.0.0.1:4793',
      PVB_STAGING_WORKER_JWT: 'synthetic-receipt-token',
      PVB_STAGING_APP_KEY: 'synthetic-app-token',
      PVB_STAGING_RECEIPT_KEY_B64: key.toString('base64'),
      PVB_STAGING_EXPECTED_SYSTEM_ID: '12345',
      PVB_STAGING_EXPECTED_APP_SYSTEM_ID: '67890',
    },
  });

  expect(result).toMatchObject({ claimed: 1, processed: 0, retryable: 1 });
  expect(appRpc).toHaveBeenCalledExactlyOnceWith('piggyvest_staging_system_id');
});
