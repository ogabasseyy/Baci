import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePlaceOrder } from './place-order';

const navigation = vi.hoisted(() => ({ oxygen: vi.fn() }));
vi.mock('./navigate-to-oxygen-order', () => ({
  navigateToOxygenOrder: navigation.oxygen,
}));

// Mock dependencies
vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/lib/credpal', () => ({
  openCredPalCheckout: vi.fn(),
}));

vi.mock('@/lib/credit-direct-client', () => ({
  openCreditDirectCheckout: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signUp: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
  })),
}));

import { buildOpts, mockFetch } from './place-order.test-helpers';

global.fetch = mockFetch;

describe('handlePlaceOrder', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    mockFetch.mockReset();
    window.sessionStorage.clear();
  });

  describe('Account Creation', () => {
    it('attempts signup when createAccount is true and no user', async () => {
      const { createClient } = await import('@/lib/supabase/client');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          order: { id: 'order-acc' },
          wallet: null,
          amountDueToGateway: 12000,
        }),
      });

      const opts = buildOpts({
        paymentMethod: 'invoice',
        createAccount: true,
        accountPassword: 'securepass123',
      });
      await handlePlaceOrder(opts);

      expect(createClient).toHaveBeenCalled();
    });
  });

  describe('Error Recovery', () => {
    it('resets state on checkout error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const opts = buildOpts();
      await handlePlaceOrder(opts);

      expect(opts.setIsProcessing).toHaveBeenCalledWith(false);
      expect(opts.isOrderInFlightRef.current).toBe(false);
      expect(opts.setCurrentStep).toHaveBeenCalledWith('payment');
      expect(opts.setCompletedSteps).toHaveBeenCalledWith({
        contact: true,
        delivery: true,
      });
    });
  });
  it('hands a signed-in local Oxygen checkout to its owned order without financial actions', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_OXYGEN_LOCAL_CHECKOUT', 'true');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:3451');
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        order: { id: '60000000-0000-4000-8000-000000000001' },
        amountDueToGateway: 12000,
      }),
    });
    const opts = buildOpts({
      paymentMethod: 'oxygen',
      user: { id: 'user' },
      payWithWallet: false,
    });
    await handlePlaceOrder(opts);
    expect(navigation.oxygen).toHaveBeenCalledExactlyOnceWith(
      '60000000-0000-4000-8000-000000000001'
    );
    expect(opts.routerPush).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).payment_method).toBe(
      'oxygen'
    );
    expect(opts.clearCart).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
  it('blocks Oxygen order creation when production admission cannot be checked', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const opts = buildOpts({ paymentMethod: 'oxygen', user: { id: 'user' } });
    await handlePlaceOrder(opts);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('/api/payments/oxygen/storefront-availability');
    expect(opts.routerPush).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
  it('permits the admitted production pilot to create an Oxygen order', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ available: true }) });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ order: { id: '60000000-0000-4000-8000-000000000001' }, amountDueToGateway: 12000 }) });
    const opts = buildOpts({ paymentMethod: 'oxygen', user: { id: 'user' }, payWithWallet: false });
    await handlePlaceOrder(opts);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(navigation.oxygen).toHaveBeenCalledWith('60000000-0000-4000-8000-000000000001');
  });
});
