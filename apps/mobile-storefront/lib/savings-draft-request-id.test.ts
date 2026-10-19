import { beforeEach, expect, it, jest } from '@jest/globals';
import { savingsDraftRequestId } from './savings-draft-request-id';

const mockValues = new Map<string, string>();
const mockSet = jest.fn<(key: string, value: string) => Promise<void>>();
const mockRandom = jest.fn<() => string>();
const mockHostedProfile = {
  mode: 'hosted-staging',
  apiOrigin: 'https://staging.ogabassey.com',
  supabaseOrigin: 'https://auth.example.test',
  expectedAuthIssuer: 'https://auth.example.test/auth/v1',
  merchantId: '11111111-1111-4111-8111-111111111111',
};
const mockStorageScope = { mode: '0', profile: undefined as unknown };
jest.mock('./storefront-storage-prefix', () => {
  const actual = jest.requireActual<
    typeof import('./storefront-storage-prefix')
  >('./storefront-storage-prefix');
  return {
    getStorefrontStoragePrefix: () =>
      actual.getStorefrontStoragePrefix(
        mockStorageScope.mode,
        mockStorageScope.profile,
        {
          supabaseOrigins: [
            'https://auth.example.test',
            'https://other.example.test',
          ],
        },
        true
      ),
  };
});
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockValues.get(key) ?? null,
    setItem: (key: string, value: string) => mockSet(key, value),
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => mockRandom() }));
jest.mock('@/lib/local-storefront-storage-prefix', () => ({
  getLocalStorefrontStoragePrefix: () => 'local-fixture.',
}));
const scope = {
  userId: 'customer-a',
  merchantId: 'merchant',
  productId: 'device',
  variantId: 'variant-a',
};
beforeEach(() => {
  mockStorageScope.mode = '0';
  mockStorageScope.profile = undefined;
  mockValues.clear();
  mockSet.mockReset().mockImplementation(async (key, value) => {
    mockValues.set(key, value);
  });
  mockRandom
    .mockReset()
    .mockReturnValue('30000000-0000-4000-8000-000000000001');
});
it('retains one request across parallel clicks and retries', async () => {
  const [first, second] = await Promise.all([
    savingsDraftRequestId(scope),
    savingsDraftRequestId(scope),
  ]);
  expect(first).toBe(second);
  expect(await savingsDraftRequestId(scope)).toBe(first);
  expect(mockRandom).toHaveBeenCalledTimes(1);
});
it('separates exact variants and users rather than reusing another request', async () => {
  await savingsDraftRequestId(scope);
  await savingsDraftRequestId({ ...scope, userId: 'customer-b' });
  await savingsDraftRequestId({ ...scope, variantId: 'variant-b' });
  expect(mockValues.size).toBe(3);
});
it('fails closed before dispatch if persistent storage fails', async () => {
  mockSet.mockRejectedValue(new Error('Storage unavailable'));
  await expect(savingsDraftRequestId(scope)).rejects.toThrow(
    'Storage unavailable'
  );
});
it('rotates only an explicitly matched old request and rejects concurrent stale rotation', async () => {
  const old = await savingsDraftRequestId(scope);
  const replacement = '30000000-0000-4000-8000-000000000002';
  mockRandom.mockReturnValue(replacement);
  const results = await Promise.allSettled([
    savingsDraftRequestId(scope, old),
    savingsDraftRequestId(scope, old),
  ]);
  expect(results.map((result) => result.status)).toEqual([
    'fulfilled',
    'rejected',
  ]);
  expect(await savingsDraftRequestId(scope)).toBe(replacement);
  expect(mockRandom).toHaveBeenCalledTimes(2);
});
it('does not generate a replacement for a mismatched or missing old request', async () => {
  await expect(savingsDraftRequestId(scope, 'old-request')).rejects.toThrow();
  expect(mockRandom).not.toHaveBeenCalled();
});

it('isolates hosted draft retries and rotation from local and sibling hosted profiles', async () => {
  const localId = await savingsDraftRequestId(scope);
  mockStorageScope.mode = '1';
  mockStorageScope.profile = mockHostedProfile;
  const hostedId = '30000000-0000-4000-8000-000000000002';
  mockRandom.mockReturnValue(hostedId);
  expect(await savingsDraftRequestId(scope)).toBe(hostedId);
  expect(await savingsDraftRequestId(scope)).toBe(hostedId);
  await expect(savingsDraftRequestId(scope, localId)).rejects.toThrow(
    'Saved draft request changed'
  );
  mockStorageScope.profile = {
    ...mockHostedProfile,
    supabaseOrigin: 'https://other.example.test',
    expectedAuthIssuer: 'https://other.example.test/auth/v1',
  };
  const siblingId = '30000000-0000-4000-8000-000000000003';
  mockRandom.mockReturnValue(siblingId);
  expect(await savingsDraftRequestId(scope)).toBe(siblingId);
  mockStorageScope.mode = '0';
  expect(await savingsDraftRequestId(scope)).toBe(localId);
  expect(mockValues.size).toBe(3);
  expect(
    [...mockValues.keys()].filter((key) =>
      key.startsWith('baci-hosted-staging-')
    )
  ).toHaveLength(2);
});

it('does not read or overwrite a local request when a hosted profile is missing or untrusted', async () => {
  const localId = await savingsDraftRequestId(scope);
  mockSet.mockClear();
  mockRandom.mockClear();
  mockStorageScope.mode = '1';
  await expect(savingsDraftRequestId(scope)).rejects.toThrow();
  mockStorageScope.profile = {
    ...mockHostedProfile,
    supabaseOrigin: 'https://untrusted.example.test',
  };
  await expect(savingsDraftRequestId(scope)).rejects.toThrow();
  expect(mockSet).not.toHaveBeenCalled();
  expect(mockRandom).not.toHaveBeenCalled();
  expect([...mockValues.values()]).toEqual([localId]);
});
