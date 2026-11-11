import { expect, it, vi } from 'vitest';
import {
  buildDomesticRequest,
  giglQuote,
  mockCreateServerClient,
  mockGetQuotes,
} from './route.merchant-rates.test-fixtures';

it('returns merchantless domestic carrier quotes without tenant persistence or read capabilities', async () => {
  const rpc = vi.fn();
  const from = vi.fn();
  mockCreateServerClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    rpc,
    from,
  });
  mockGetQuotes.mockResolvedValue({
    quotes: { all: [giglQuote], featured: [giglQuote] },
    sessionId: 'synthetic',
    expiresAt: giglQuote.expiresAt,
  });
  const { POST } = await import('./route');
  const response = await POST(buildDomesticRequest());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.quotes.all).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ provider: 'GIGL', price: 5000 }),
    ])
  );
  expect(mockGetQuotes).toHaveBeenCalledWith(
    expect.objectContaining({
      merchantId: undefined,
      sender: expect.objectContaining({ city: 'Lagos' }),
    }),
    expect.arrayContaining(['GIGL', 'TOPSHIP'])
  );
  expect(rpc).not.toHaveBeenCalled();
  expect(from).not.toHaveBeenCalled();
  expect(response.headers.get('X-Baci-Quote-Read-Token')).toBeNull();
});
