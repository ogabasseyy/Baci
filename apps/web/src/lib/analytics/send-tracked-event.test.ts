// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAnalyticsAllowed, mockMarketingAllowed } = vi.hoisted(() => ({
  mockAnalyticsAllowed: vi.fn(() => true),
  mockMarketingAllowed: vi.fn(() => false),
}));

vi.mock('@/lib/analytics-consent', () => ({
  isAnalyticsAllowed: mockAnalyticsAllowed,
}));
vi.mock('@/lib/marketing-consent', () => ({
  isMarketingAllowed: mockMarketingAllowed,
}));

import { sendTrackedEvent } from './send-tracked-event';

const addToCart = {
  event_type: 'add_to_cart',
  merchant_id: 'merchant-1',
  product_id: 'prod-1',
  product_name: 'Phone',
  product_price: 100,
  quantity: 1,
  currency: 'NGN',
} as const;

const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

function sentInit(): RequestInit {
  const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return call[1];
}

describe('sendTrackedEvent', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends with keepalive so an add right before navigation is not cancelled', async () => {
    await sendTrackedEvent(addToCart);

    expect(fetchMock).toHaveBeenCalledWith('/api/events', expect.anything());
    expect(sentInit().keepalive).toBe(true);
  });

  it('drops keepalive for bodies over the browser keepalive budget', async () => {
    await sendTrackedEvent({
      event_type: 'search',
      merchant_id: 'merchant-1',
      search_term: 'x'.repeat(70_000),
    });

    expect(sentInit().keepalive).toBe(false);
  });

  it('keeps passing the current consent flags unchanged', async () => {
    await sendTrackedEvent({ ...addToCart, event_type: 'product_view' });

    const body = JSON.parse(String(sentInit().body));
    expect(body).toMatchObject({
      event_type: 'product_view',
      analytics_consent: true,
      marketing_consent: false,
    });
    expect(body.session_id).toMatch(/^sess_/);
  });

  it('swallows network failures', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(sendTrackedEvent(addToCart)).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
