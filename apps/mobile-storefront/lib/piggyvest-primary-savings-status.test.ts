import { expect, it, jest } from '@jest/globals';

const mockFetchJson = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCreateClient = jest.fn((..._args: unknown[]) => ({
  fetchJson: mockFetchJson,
}));
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: (...args: unknown[]) =>
    mockCreateClient(...args),
}));
let mockAuthUserId: string | null = null;
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({
      user: mockAuthUserId ? { id: mockAuthUserId } : null,
    }),
  },
}));
const { checkPiggyvestPrimarySavingsStatus } =
  require('./piggyvest-primary-savings-status') as typeof import('./piggyvest-primary-savings-status');
const input = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  operationId: '22222222-2222-4222-8222-222222222222',
};
it('uses a status-only PATCH with CSRF and checks the echoed operation', async () => {
  mockFetchJson.mockResolvedValue({
    operationId: input.operationId,
    status: 'pending',
  });
  expect(await checkPiggyvestPrimarySavingsStatus(input)).toEqual({
    operationId: input.operationId,
    status: 'pending',
  });
  expect(mockFetchJson).toHaveBeenCalledWith({
    path: '/api/storefront/customer/savings/primary-transfer',
    method: 'PATCH',
    includeCsrf: true,
    body: input,
    signal: expect.any(AbortSignal),
    timeoutMs: 15_000,
  });
  mockFetchJson.mockResolvedValue({
    operationId: input.merchantId,
    status: 'confirmed',
  });
  await expect(checkPiggyvestPrimarySavingsStatus(input)).rejects.toThrow(
    'could not be confirmed'
  );
});
it('pins the status poll to the initiating user', async () => {
  jest.clearAllMocks();
  mockAuthUserId = 'user-A';
  mockFetchJson.mockResolvedValue({
    operationId: input.operationId,
    status: 'pending',
  });
  await checkPiggyvestPrimarySavingsStatus(input);
  expect(mockFetchJson).toHaveBeenCalledWith(
    expect.objectContaining({ expectedUserId: 'user-A' })
  );
  mockAuthUserId = null;
});
it('constructs a fresh API client for every status check', async () => {
  jest.clearAllMocks();
  mockFetchJson.mockResolvedValue({
    operationId: input.operationId,
    status: 'pending',
  });
  await checkPiggyvestPrimarySavingsStatus(input);
  await checkPiggyvestPrimarySavingsStatus(input);
  expect(mockCreateClient).toHaveBeenCalledTimes(2);
});
it('gives up on a read that never settles after 15 s, aborting it', async () => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  try {
    let signal: AbortSignal | undefined;
    // Session, CSRF or PATCH stalled: the promise never settles by itself.
    mockFetchJson.mockImplementation((...args: unknown[]) => {
      signal = (args[0] as { signal?: AbortSignal }).signal;
      return new Promise(() => undefined);
    });
    const check = checkPiggyvestPrimarySavingsStatus(input);
    const settled = jest.fn();
    check.then(settled, settled);
    await jest.advanceTimersByTimeAsync(14_999);
    expect(settled).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await expect(check).rejects.toThrow('timed out after 15000ms');
    expect(signal?.aborted).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});
