import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import { customerSavingsDrafts } from './customer-savings-drafts';

const mockSession = jest.fn<() => Promise<unknown>>();
const mockFetch = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: () => mockSession() } },
}));
jest.mock('@/env', () => ({ EXPO_PUBLIC_API_URL: 'http://192.168.1.5:4193' }));
jest.mock('@/lib/fetch-with-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetch(...args),
}));
const previous = process.env.EXPO_PUBLIC_LOCAL_STOREFRONT;
const scope = {
  userId: 'synthetic-user',
  merchantId: '10000000-0000-4000-8000-000000000001',
};
beforeEach(() => {
  process.env.EXPO_PUBLIC_LOCAL_STOREFRONT = '1';
  mockFetch.mockReset();
  mockSession.mockResolvedValue({
    data: {
      session: { user: { id: scope.userId }, access_token: 'synthetic-token' },
    },
    error: null,
  });
});
afterEach(() => {
  if (previous === undefined) delete process.env.EXPO_PUBLIC_LOCAL_STOREFRONT;
  else process.env.EXPO_PUBLIC_LOCAL_STOREFRONT = previous;
});
it('uses the real current session bearer and scopes the collection request', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ drafts: [] }) });
  expect(await customerSavingsDrafts.list(scope)).toEqual([]);
  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining(`merchantId=${scope.merchantId}`),
    expect.objectContaining({
      headers: { Authorization: 'Bearer synthetic-token' },
      method: 'GET',
      redirect: 'error',
    })
  );
});
it('does not dispatch when local mode is absent or the authenticated user changed', async () => {
  mockSession.mockResolvedValue({
    data: {
      session: { user: { id: 'different-user' }, access_token: 'other' },
    },
  });
  await expect(customerSavingsDrafts.list(scope)).rejects.toThrow(
    'session changed'
  );
  delete process.env.EXPO_PUBLIC_LOCAL_STOREFRONT;
  await expect(customerSavingsDrafts.list(scope)).rejects.toThrow(
    'unavailable'
  );
  expect(mockFetch).not.toHaveBeenCalled();
});
it('rejects malformed responses and reports unavailable API responses without provider details', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ drafts: [{}] }),
  });
  await expect(customerSavingsDrafts.list(scope)).rejects.toThrow();
  mockFetch.mockResolvedValue({ ok: false, status: 503 });
  await expect(customerSavingsDrafts.list(scope)).rejects.toThrow(
    'Unable to load or save'
  );
});
it('preserves definitive stale-draft codes without exposing server messages', async () => {
  mockFetch.mockResolvedValue({
    ok: false,
    status: 409,
    json: async () => ({
      code: 'SAVINGS_DRAFT_REVIEW_REQUIRED',
      error: 'private detail',
    }),
  });
  await expect(customerSavingsDrafts.list(scope)).rejects.toMatchObject({
    code: 'SAVINGS_DRAFT_REVIEW_REQUIRED',
    status: 409,
  });
  await expect(customerSavingsDrafts.list(scope)).rejects.not.toThrow(
    'private detail'
  );
});
