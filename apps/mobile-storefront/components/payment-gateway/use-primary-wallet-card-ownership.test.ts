import { act, renderHook, waitFor } from '@testing-library/react-native';
import { usePrimaryWalletCardOwnership } from './use-primary-wallet-card-ownership';

const mockReadPending = jest.fn();
const mockPeekStatus = jest.fn();
jest.mock('@/lib/primary-wallet-card', () => ({
  createPrimaryWalletCardFundingClient: () => ({
    readPending: (...args: unknown[]) => mockReadPending(...args),
    peekStatus: (...args: unknown[]) => mockPeekStatus(...args),
  }),
}));

const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const userId = '11111111-1111-4111-8111-111111111111';
const operationId = '22222222-2222-4222-8222-222222222222';
const reference = `pvb-first-primary-${operationId}`;
const authorizationUrl = 'https://checkout.paystack.com/Synthetic123';
const record = { operationId, merchantId, userId };

function input(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    authReady: true,
    userId,
    merchantId,
    reference,
    authorizationUrl,
    amountRaw: '1000',
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockReadPending.mockResolvedValue(record);
  mockPeekStatus.mockResolvedValue({ authorizationUrl, amountKobo: 100000 });
});

it('verifies when the record owns the reference and the server confirms URL and amount', async () => {
  const { result } = renderHook(() => usePrimaryWalletCardOwnership(input()));
  expect(result.current.ownership).toBe('pending');
  await waitFor(() => expect(result.current.ownership).toBe('verified'));
  expect(mockReadPending).toHaveBeenCalledWith({ merchantId, userId });
});

it('blocks when no device record owns the reference', async () => {
  mockReadPending.mockResolvedValue(null);
  const { result } = renderHook(() => usePrimaryWalletCardOwnership(input()));
  await waitFor(() => expect(result.current.ownership).toBe('blocked'));
  expect(mockPeekStatus).not.toHaveBeenCalled();
});

it('blocks when the record lookup throws', async () => {
  mockReadPending.mockRejectedValue(new Error('storage unavailable'));
  const { result } = renderHook(() => usePrimaryWalletCardOwnership(input()));
  await waitFor(() => expect(result.current.ownership).toBe('blocked'));
});

it('blocks without a lookup when auth resolved with no signed-in user', () => {
  const { result } = renderHook(() =>
    usePrimaryWalletCardOwnership(input({ userId: undefined }))
  );
  expect(result.current.ownership).toBe('blocked');
  expect(mockReadPending).not.toHaveBeenCalled();
});

it('mismatches when the server reports a different checkout URL', async () => {
  mockPeekStatus.mockResolvedValue({
    authorizationUrl: 'https://checkout.paystack.com/Forged456',
    amountKobo: 100000,
  });
  const { result } = renderHook(() => usePrimaryWalletCardOwnership(input()));
  await waitFor(() => expect(result.current.ownership).toBe('mismatch'));
});

it('mismatches when the params amount differs from the server kobo', async () => {
  mockPeekStatus.mockResolvedValue({ authorizationUrl, amountKobo: 99900 });
  const { result } = renderHook(() => usePrimaryWalletCardOwnership(input()));
  await waitFor(() => expect(result.current.ownership).toBe('mismatch'));
});

it('mismatches when the params amount is unparseable', async () => {
  const { result } = renderHook(() =>
    usePrimaryWalletCardOwnership(input({ amountRaw: 'not-a-number' }))
  );
  await waitFor(() => expect(result.current.ownership).toBe('mismatch'));
});

it('mismatches when the server bind throws', async () => {
  mockPeekStatus.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => usePrimaryWalletCardOwnership(input()));
  await waitFor(() => expect(result.current.ownership).toBe('mismatch'));
});

it('retries the bind read-only after a transient failure', async () => {
  mockPeekStatus.mockRejectedValueOnce(new Error('offline'));
  const { result } = renderHook(() => usePrimaryWalletCardOwnership(input()));
  await waitFor(() => expect(result.current.ownership).toBe('mismatch'));
  act(() => result.current.retryBind());
  await waitFor(() => expect(result.current.ownership).toBe('verified'));
});

it('holds pending until auth hydrates, then verifies', async () => {
  const { result, rerender } = renderHook(
    ({ authReady }: { authReady: boolean }) =>
      usePrimaryWalletCardOwnership(input({ authReady })),
    { initialProps: { authReady: false } }
  );
  expect(result.current.ownership).toBe('pending');
  expect(mockReadPending).not.toHaveBeenCalled();
  rerender({ authReady: true });
  await waitFor(() => expect(result.current.ownership).toBe('verified'));
});

it('stays pending without a lookup when disabled', () => {
  const { result } = renderHook(() =>
    usePrimaryWalletCardOwnership(input({ enabled: false }))
  );
  expect(result.current.ownership).toBe('pending');
  expect(mockReadPending).not.toHaveBeenCalled();
});
