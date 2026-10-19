import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Barrel-first by construction: the only paystack import in this
// file is the dynamic barrel import inside the test, so paystack.ts
// evaluates before the verify leaf. paystack.ts re-exports
// verifyTransaction, so any top-level cycle use in the verify module
// crashes that import (as it did across all six CI shards).
// Importing the leaf module first would mask the cycle. Dynamic
// (not static) because paystackRequest snapshots the secret key at
// import time, after the stub below is armed.

describe('verifyTransaction via the paystack barrel', () => {
  beforeEach(() => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_123');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('verifies with decimal-text ids when reached through the barrel', async () => {
    const { verifyTransaction } = await import('@/lib/paystack');
    const big = '9007199254740993';
    const raw =
      `{"status":true,"message":"ok","data":{"id":${big},` +
      `"reference":"PSK-1","amount":10000,"currency":"NGN",` +
      `"channel":"card","status":"success","paid_at":null,` +
      `"created_at":"2026-08-05T08:29:00Z",` +
      `"customer":{"id":7,"email":"c@example.com",` +
      `"customer_code":"CUS-1","first_name":null,` +
      `"last_name":null,"phone":null},` +
      `"metadata":null,"fees":100,"fees_split":null}}`;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => JSON.parse(raw),
        text: async () => raw,
      })
    );

    const result = await verifyTransaction('PSK-1', undefined, {
      textIds: true,
    });

    expect(result).toMatchObject({ success: true });
    if (result.success) expect(result.data.id).toBe(big);
  });
});
