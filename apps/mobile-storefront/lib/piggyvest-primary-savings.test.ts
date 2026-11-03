import { createHash } from 'node:crypto';
import { beforeEach, expect, it, jest } from '@jest/globals';

const mockFetchJson = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockLegacyAdd = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockRecover = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockCreateClient = jest.fn((..._args: unknown[]) => ({
  fetchJson: mockFetchJson,
}));
jest.mock('./storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: (...args: unknown[]) =>
    mockCreateClient(...args),
}));
jest.mock('./customer-savings', () => ({
  addSavingsContribution: (...args: unknown[]) => mockLegacyAdd(...args),
}));
jest.mock('./piggyvest-primary-savings-recovery', () => ({
  recoverPiggyvestPrimarySavings: (...args: unknown[]) => mockRecover(...args),
}));
let mockAuthUserId: string | null = null;
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({
      user: mockAuthUserId ? { id: mockAuthUserId } : null,
    }),
  },
}));
const { addPiggyvestPrimarySavingsContribution } =
  require('./piggyvest-primary-savings') as typeof import('./piggyvest-primary-savings');
const input = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  goalId: '22222222-2222-4222-8222-222222222222',
  idempotencyKey: '33333333-3333-4333-8333-333333333333',
  amount: 20,
};
beforeEach(() => {
  jest.clearAllMocks();
});
it('posts integer kobo and the existing operation key with CSRF', async () => {
  mockFetchJson.mockResolvedValue({
    status: 'pending',
    operationId: input.idempotencyKey,
  });
  expect(await addPiggyvestPrimarySavingsContribution(input)).toEqual({
    status: 'pending',
    operationId: input.idempotencyKey,
  });
  expect(mockFetchJson).toHaveBeenCalledWith({
    path: '/api/storefront/customer/savings/primary-transfer',
    method: 'POST',
    includeCsrf: true,
    body: {
      merchantId: input.merchantId,
      goalId: input.goalId,
      operationId: input.idempotencyKey,
      amountKobo: 2000,
    },
  });
});
it('pins the submission to the initiating user', async () => {
  mockAuthUserId = 'user-A';
  mockFetchJson.mockResolvedValue({
    status: 'pending',
    operationId: input.idempotencyKey,
  });
  await addPiggyvestPrimarySavingsContribution(input);
  expect(mockFetchJson).toHaveBeenCalledWith(
    expect.objectContaining({ expectedUserId: 'user-A' })
  );
  mockAuthUserId = null;
});
it('does not accept a response for another operation', async () => {
  mockFetchJson.mockResolvedValue({
    status: 'confirmed',
    operationId: input.goalId,
  });
  await expect(addPiggyvestPrimarySavingsContribution(input)).rejects.toThrow(
    'could not be confirmed'
  );
});
it('passes a terminal cancellation through instead of reporting it as unconfirmed', async () => {
  mockFetchJson.mockResolvedValue({
    status: 'cancelled',
    operationId: input.idempotencyKey,
  });
  await expect(addPiggyvestPrimarySavingsContribution(input)).resolves.toEqual({
    status: 'cancelled',
    operationId: input.idempotencyKey,
  });
});
it('rejects fractions smaller than kobo before requesting a payment', async () => {
  await expect(
    addPiggyvestPrimarySavingsContribution({ ...input, amount: 0.001 })
  ).rejects.toThrow();
  expect(mockFetchJson).not.toHaveBeenCalled();
});
it('routes the contribution through legacy savings when primary is unconfigured', async () => {
  mockFetchJson.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'SAVINGS_NOT_READY' })
  );
  mockRecover.mockResolvedValue(null);
  mockLegacyAdd.mockResolvedValue({ status: 'pending' });
  await expect(addPiggyvestPrimarySavingsContribution(input)).resolves.toEqual({
    status: 'pending',
  });
  expect(mockRecover).toHaveBeenCalledWith({
    merchantId: input.merchantId,
    goalId: input.goalId,
  });
  expect(mockLegacyAdd).toHaveBeenCalledWith(input);
});
it('never falls back to legacy for an id already bound to primary', async () => {
  mockFetchJson.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'SAVINGS_NOT_READY' })
  );
  await expect(
    addPiggyvestPrimarySavingsContribution({
      ...input,
      allowLegacyFallback: false,
    })
  ).rejects.toThrow(/checking your earlier contribution/i);
  expect(mockRecover).not.toHaveBeenCalled();
  expect(mockLegacyAdd).not.toHaveBeenCalled();
});

it('blocks legacy fallback while a primary operation is still pending', async () => {
  mockFetchJson.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'SAVINGS_NOT_READY' })
  );
  mockRecover.mockResolvedValue({
    operationId: input.idempotencyKey,
    goalId: input.goalId,
    amountKobo: 2000,
  });
  await expect(addPiggyvestPrimarySavingsContribution(input)).rejects.toThrow(
    'still processing'
  );
  expect(mockLegacyAdd).not.toHaveBeenCalled();
});
it('blocks legacy fallback when the pending lookup itself fails', async () => {
  mockFetchJson.mockRejectedValue(
    Object.assign(new Error('unavailable'), { code: 'SAVINGS_NOT_READY' })
  );
  mockRecover.mockRejectedValue(new Error('lookup down'));
  await expect(addPiggyvestPrimarySavingsContribution(input)).rejects.toThrow(
    'lookup down'
  );
  expect(mockLegacyAdd).not.toHaveBeenCalled();
});
it('surfaces ambiguous failures instead of silently switching rails', async () => {
  mockFetchJson.mockRejectedValue(new Error('timeout'));
  await expect(addPiggyvestPrimarySavingsContribution(input)).rejects.toThrow(
    'timeout'
  );
  expect(mockLegacyAdd).not.toHaveBeenCalled();
});
it('constructs a fresh API client for every contribution', async () => {
  mockFetchJson.mockResolvedValue({
    status: 'pending',
    operationId: input.idempotencyKey,
  });
  await addPiggyvestPrimarySavingsContribution(input);
  await addPiggyvestPrimarySavingsContribution(input);
  expect(mockCreateClient).toHaveBeenCalledTimes(2);
});
it('sends the PIN proof in the body only when one is given', async () => {
  const pinProof = createHash('sha256').update('s5m-body-proof').digest('hex');
  mockFetchJson.mockResolvedValue({
    status: 'pending',
    operationId: input.idempotencyKey,
  });
  await addPiggyvestPrimarySavingsContribution({ ...input, pinProof });
  expect(mockFetchJson).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({ pinProof, amountKobo: 2000 }),
    })
  );
});
it('rejects a malformed PIN proof before any request', async () => {
  await expect(
    addPiggyvestPrimarySavingsContribution({ ...input, pinProof: 'nope' })
  ).rejects.toThrow();
  expect(mockFetchJson).not.toHaveBeenCalled();
});
it('never forwards the PIN proof to the legacy rail', async () => {
  const pinProof = createHash('sha256')
    .update('s5m-legacy-proof')
    .digest('hex');
  mockFetchJson.mockRejectedValue(
    Object.assign(new Error('not ready'), { code: 'PIGGYVEST_NOT_READY' })
  );
  mockRecover.mockResolvedValue(null);
  mockLegacyAdd.mockResolvedValue({ legacy: true });
  await addPiggyvestPrimarySavingsContribution({ ...input, pinProof });
  expect(mockLegacyAdd).toHaveBeenCalledWith(
    expect.not.objectContaining({ pinProof })
  );
});
