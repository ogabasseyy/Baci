import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDomesticRequest,
  EMPTY_RATES_PAYLOAD,
  giglQuote,
  mockCreateAdminClient,
  mockCreateServerClient,
  mockGetMerchantForApiRequest,
  mockGetQuotes,
} from './route.merchant-rates.test-fixtures';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const EXPIRY = '2099-01-01T00:00:00.000Z';
const receiver = {
  name: 'Quote Diagnostic',
  email: 'quote-check@example.com',
  phone: '',
  address: '15 Example Street, Akoka, Lagos, Nigeria',
  city: 'Yaba',
  state: 'Lagos',
  country: 'Nigeria',
};

describe('legacy mobile shipping quotes without a client header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMerchantForApiRequest.mockResolvedValue(null);
  });

  it.each([
    null,
    { id: 'user-1' },
  ])('rejects an unpublished international merchant without a client header for user %j', async (user) => {
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({ data: {}, error: null }),
    };
    mockCreateServerClient.mockResolvedValue(client);
    mockCreateAdminClient.mockReturnValue(client);
    const { POST } = await import('./route');
    const request = buildDomesticRequest({
      merchantId: MERCHANT_ID,
      shipmentType: 'international',
      receiver: {
        ...receiver,
        address: '123 Queen Street West',
        city: 'Toronto',
        state: 'Ontario',
        country: 'Canada',
        countryCode: 'CA',
      },
      sender: { ...receiver, phone: '08099999999' },
      items: [
        {
          name: 'Phone',
          hsCode: '851712',
          quantity: 1,
          weight: 1,
          value: 100_000,
        },
      ],
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Sender is required for international quotes',
    });
    expect(client.from).not.toHaveBeenCalled();
    expect(mockGetQuotes).not.toHaveBeenCalled();
  });

  it.each([
    'door',
    'pickup_station',
  ])('returns %s rates using the public merchant origin for a headerless Yaba request', async (deliveryPreference) => {
    const anonymousFrom = vi.fn(() => {
      throw new Error('Anonymous quote lookup must not read private tables');
    });
    const publicRpc = vi.fn().mockResolvedValue({
      data: {
        business_name: 'Merchant Store',
        business_address: '1 Merchant Road, Ikeja, Lagos',
        phone: '+2348012345678',
        country: 'NG',
        state_code: 'LA',
      },
      error: null,
    });
    mockCreateServerClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: anonymousFrom,
      rpc: publicRpc,
    });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const privilegedFrom = vi.fn((table: string) => {
      if (table !== 'shipping_quotes') {
        throw new Error(`Unexpected privileged table lookup: ${table}`);
      }
      return { upsert };
    });
    const rateRpc = vi.fn().mockResolvedValue({
      data: EMPTY_RATES_PAYLOAD,
      error: null,
    });
    mockCreateAdminClient.mockReturnValue({
      from: privilegedFrom,
      rpc: rateRpc,
    });
    const quote = { ...giglQuote, expiresAt: new Date(EXPIRY) };
    mockGetQuotes.mockResolvedValue({
      quotes: { featured: [quote], all: [quote] },
      sessionId: 'session-legacy',
      expiresAt: EXPIRY,
    });
    const request = buildDomesticRequest({
      merchantId: MERCHANT_ID,
      receiver,
      deliveryPreference,
    });
    const { POST } = await import('./route');

    const response = await POST(request);
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.quotes.all).toEqual([
      expect.objectContaining({ provider: 'GIGL', id: quote.id }),
    ]);
    expect(mockGetQuotes).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryPreference,
        receiver: expect.objectContaining(receiver),
        sender: expect.objectContaining({ city: 'Ikeja', state: 'Lagos' }),
      }),
      []
    );
    expect(publicRpc).toHaveBeenCalledWith('get_storefront_shipping_sender', {
      p_merchant_id: MERCHANT_ID,
    });
    expect(anonymousFrom).not.toHaveBeenCalled();
    expect(privilegedFrom).not.toHaveBeenCalledWith('merchants');
    expect(rateRpc).not.toHaveBeenCalledWith(
      'get_storefront_shipping_sender',
      expect.anything()
    );
    expect(upsert).toHaveBeenCalledOnce();
  });
});
