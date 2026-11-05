import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  csrf: vi.fn(),
  resolveMerchant: vi.fn(),
  pathMerchant: vi.fn(),
  loadRates: vi.fn(),
  buildResponse: vi.fn(),
  publicResponse: vi.fn(),
}));

vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/storefront-merchant', () => ({
  resolveStorefrontMerchantFromRequest: mocks.resolveMerchant,
}));
vi.mock('@/lib/get-merchant-by-identifier-or-alias', () => ({
  getMerchantByIdentifierOrAlias: mocks.pathMerchant,
}));
vi.mock('@/app/api/shipping/quotes/load-public-merchant-rates', () => ({
  loadPublicMerchantRates: mocks.loadRates,
}));
vi.mock('@/app/api/shipping/quotes/quote-source-orchestration', () => ({
  buildMerchantOnlyQuoteResponse: mocks.buildResponse,
}));
vi.mock('@/app/api/shipping/quotes/public-quote-response', () => ({
  toPublicQuoteResponse: mocks.publicResponse,
}));

import { POST } from './route';

function request(body: unknown, host = 'usebaci.com') {
  return new NextRequest(
    `https://${host}/api/storefront/acme/delivery-estimate`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host,
        cookie: 'csrf-token=test-token',
        'x-csrf-token': 'test-token',
      },
      body: JSON.stringify(body),
    }
  );
}

function context(slug = 'acme') {
  return { params: Promise.resolve({ slug }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.resolveMerchant.mockResolvedValue({
    success: true,
    identifier: 'acme',
    merchant: { id: 'merchant-1', country: 'NG', payout_currency: 'NGN' },
  });
  mocks.pathMerchant.mockResolvedValue({ id: 'merchant-1' });
  mocks.loadRates.mockResolvedValue({ quotes: [{ id: 'rate-1' }] });
  mocks.buildResponse.mockReturnValue({ quotes: { all: [{ id: 'rate-1' }] } });
  mocks.publicResponse.mockImplementation((response) => response);
});

describe('POST /api/storefront/[slug]/delivery-estimate', () => {
  it('supports a root-domain path merchant and returns an uncached public estimate', async () => {
    const response = await POST(request({ state: 'Lagos' }), context());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.resolveMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackIdentifier: 'acme' })
    );
    expect(mocks.loadRates).toHaveBeenCalledWith('merchant-1', {
      receiverCountryCode: 'NG',
      receiverState: 'Lagos',
      merchantCurrency: 'NGN',
    });
  });

  it('rejects a host/path merchant mismatch before loading rates', async () => {
    mocks.resolveMerchant.mockResolvedValueOnce({
      success: true,
      identifier: 'other-store',
      merchant: { id: 'merchant-2', country: 'NG', payout_currency: 'NGN' },
    });
    expect(
      (
        await POST(
          request({ state: 'Lagos' }, 'other-store.usebaci.com'),
          context()
        )
      ).status
    ).toBe(404);
    expect(mocks.loadRates).not.toHaveBeenCalled();
  });

  it('returns a safe service error when path merchant lookup fails', async () => {
    mocks.pathMerchant.mockRejectedValueOnce(
      new Error('database password and internal details')
    );

    const response = await POST(request({ state: 'Lagos' }), context());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Store delivery rates could not be loaded',
    });
    expect(mocks.loadRates).not.toHaveBeenCalled();
  });

  it('rejects invalid slug, state, and forged body tenant fields', async () => {
    expect(
      (await POST(request({ state: 'Lagos' }), context('../bad'))).status
    ).toBe(400);
    expect((await POST(request({ state: 'Atlantis' }), context())).status).toBe(
      400
    );
    expect(
      (
        await POST(
          request({ state: 'Lagos', merchantId: 'attacker' }),
          context()
        )
      ).status
    ).toBe(400);
    expect(mocks.resolveMerchant).not.toHaveBeenCalled();
    expect(mocks.loadRates).not.toHaveBeenCalled();
  });

  it('requires CSRF validation before resolving the merchant', async () => {
    mocks.csrf.mockResolvedValueOnce({ valid: false });
    const response = await POST(request({ state: 'Lagos' }), context());
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.resolveMerchant).not.toHaveBeenCalled();
  });

  it('blocks stores outside NGN and hides public rate load failures', async () => {
    mocks.resolveMerchant.mockResolvedValueOnce({
      success: true,
      identifier: 'acme',
      merchant: { id: 'merchant-1', country: 'GH', payout_currency: 'GHS' },
    });
    expect((await POST(request({ state: 'Lagos' }), context())).status).toBe(
      400
    );
    expect(mocks.loadRates).not.toHaveBeenCalled();

    mocks.loadRates.mockResolvedValueOnce({ loadFailed: true, quotes: [] });
    const failed = await POST(request({ state: 'Lagos' }), context());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({
      error: 'Store delivery rates could not be loaded',
    });
  });
});
