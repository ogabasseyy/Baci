import { act, renderHook } from '@testing-library/react-native';
import {
  SERVER_OFF_OPERATION_ID,
  serverOffError,
} from '@/test-support/piggyvest-server-off.test-support';
import { usePendingSavingsStatusCheck } from './use-pending-savings-status-check';

const PILOT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const mockFetchJson = jest.fn();
jest.mock('@/lib/storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({ fetchJson: mockFetchJson }),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-a' } }) },
}));
jest.mock('@/hooks/use-haptics', () => ({ triggerHaptic: () => undefined }));
const mockNotify = jest.fn();
jest.mock('./savings/savings-notice', () => ({
  notifySavings: (...args: unknown[]) => mockNotify(...args),
  savingsNotifier: () => mockNotify,
}));

function setup(operationId: string | null) {
  const props = {
    goal: null,
    merchantId: PILOT,
    idempotencyKeyRef: { current: operationId },
    operationRailRef: { current: null } as {
      current: 'primary' | 'legacy' | null;
    },
    refetchWallet: jest.fn(async () => undefined),
    setSavingsContributionAmount: jest.fn(),
  };
  return { props, view: renderHook(() => usePendingSavingsStatusCheck(props)) };
}

beforeEach(() => jest.clearAllMocks());

// With PiggyVest off on the server, a stored operation's status read is
// refused: the operation is kept, Checking ends, and no payment starts.
describe('pending status check with the server off', () => {
  it('keeps the operation, clears Checking and warns', async () => {
    mockFetchJson.mockRejectedValue(serverOffError());
    const { props, view } = setup(SERVER_OFF_OPERATION_ID);
    await act(async () => {
      expect(await view.result.current.checkStatus()).toBe('unavailable');
    });
    expect(view.result.current.isCheckingStatus).toBe(false);
    expect(props.idempotencyKeyRef.current).toBe(SERVER_OFF_OPERATION_ID);
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'PATCH' })
    );
    expect(mockNotify).toHaveBeenCalledWith(
      'Status unavailable',
      expect.any(String),
      'warning'
    );
  });

  it('sends nothing at all when no operation is stored', async () => {
    const { view } = setup(null);
    await act(async () => {
      expect(await view.result.current.checkStatus()).toBe('no-operation');
    });
    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});
