import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkProvider } from './kuda'; // Enums are fine to import statically

// A purchase request that stalls is aborted by the 15s timeout in
// kuda-transport.ts. The abort comes AFTER the request was dispatched, so the
// vend may still have landed: the result must stay `pending` for BILL_TSQ
// reconciliation, never `failed` and refunded (Codex R102 P1).

const MOCK_API_BASE = 'https://kuda-openapi.kuda.com/v2.1';

describe('Kuda purchase timeouts', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules(); // each test imports a fresh module with no cached token
    vi.stubEnv('KUDA_API_BASE_URL', MOCK_API_BASE);
    vi.stubEnv('KUDA_EMAIL', 'test@example.com');
    vi.stubEnv('KUDA_API_KEY', 'test-api-key');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // Stubs fetch so GetToken succeeds and the purchase request never answers:
  // it rejects only when the request's AbortSignal fires (the 15s timeout).
  // By default it rejects with `signal.reason`, as real fetch does. That is a
  // DOMException, which is an Error in Node, so the outcome does not depend on
  // which DOMException class the test environment installs (jsdom's is not an
  // Error in Node's realm).
  const stubStalledPurchase = (
    abortReason: (signal: AbortSignal) => unknown = (signal) => signal.reason
  ) => {
    globalThis.fetch = vi.fn().mockImplementation((url, options) => {
      if (url.toString().includes('GetToken')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('token'),
        } as Response);
      }

      const signal = options?.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(abortReason(signal)), {
          once: true,
        });
      });
    });
  };

  describe('purchaseAirtime', () => {
    it('returns a timeout error when the purchase request stalls', async () => {
      const { purchaseAirtime } = await import('./kuda');
      vi.useFakeTimers();
      stubStalledPurchase();

      const purchasePromise = purchaseAirtime(
        '08030000000',
        500,
        NetworkProvider.MTN
      );

      await vi.advanceTimersByTimeAsync(15000);

      const result = await purchasePromise;

      expect(result.success).toBe(false);
      // kudaRequest turns the abort into a timeout Error and
      // purchaseAirtime surfaces its message.
      expect(result.message).toBe('Kuda ADMIN_PURCHASE_BILL request timed out');
      // Codex R102 P1: a timeout after Kuda accepts still lands the
      // vend — pending routes to BILL_TSQ reconciliation instead of
      // refunding on top of delivered value.
      expect(result.status).toBe('pending');
    });

    it('resolves a stalled purchase as pending when the abort rejection is not an Error', async () => {
      // An AbortError that is not an Error instance (for example one from
      // another realm) skips kudaRequest's timeout conversion. The vend may
      // still have landed, so it must stay pending for BILL_TSQ
      // reconciliation, never failed and refunded.
      const { purchaseAirtime } = await import('./kuda');
      vi.useFakeTimers();
      stubStalledPurchase(() => ({ name: 'AbortError', message: 'Aborted' }));

      const purchasePromise = purchaseAirtime(
        '08030000000',
        500,
        NetworkProvider.MTN
      );

      await vi.advanceTimersByTimeAsync(15000);

      await expect(purchasePromise).resolves.toMatchObject({
        success: false,
        status: 'pending',
      });
    });
  });

  describe('purchaseData', () => {
    it('returns a timeout error when the data purchase request stalls', async () => {
      const { purchaseData } = await import('./kuda');
      vi.useFakeTimers();
      stubStalledPurchase();

      const purchasePromise = purchaseData(
        '08030000000',
        'MTN-1GB-MONTHLY',
        1000,
        NetworkProvider.MTN
      );

      await vi.advanceTimersByTimeAsync(15000);

      // Same Codex R102 P1 rule as airtime: the timeout may follow Kuda's
      // acceptance, so the row stays pending for BILL_TSQ reconciliation.
      await expect(purchasePromise).resolves.toMatchObject({
        success: false,
        message: 'Kuda ADMIN_PURCHASE_BILL request timed out',
        status: 'pending',
      });
    });
  });
});
