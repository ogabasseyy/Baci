import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { activateDueSavingsReminderSafely } from '@/services/activate-savings-reminder-safely';
import { cancelScopeSavingsReminders } from '@/services/savings-reminder-notifications';
import { useSavingsReminderActivation } from './use-savings-reminder-activation';

jest.mock('@/services/activate-savings-reminder-safely', () => ({
  activateDueSavingsReminderSafely: jest.fn(),
}));
jest.mock('@/services/savings-reminder-notifications', () => ({
  buildReminderScope: (
    userId: string | null | undefined,
    merchantId: string | null | undefined
  ) => (userId && merchantId ? { merchantId, userId } : null),
  cancelScopeSavingsReminders: jest.fn(),
}));

const mockActivate = activateDueSavingsReminderSafely as jest.MockedFunction<
  typeof activateDueSavingsReminderSafely
>;
const mockCancelScope = cancelScopeSavingsReminders as jest.MockedFunction<
  typeof cancelScopeSavingsReminders
>;

const ready = {
  isInitialized: true,
  isStorageReady: true,
  isTrackingAuthorizationSettled: true,
  storeMerchantId: 'merchant-1',
};

describe('useSavingsReminderActivation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCancelScope.mockResolvedValue(false);
  });

  it('activates on boot for a signed-in user', () => {
    renderHook(() =>
      useSavingsReminderActivation({ ...ready, storeUser: { id: 'user-a' } })
    );

    expect(mockActivate).toHaveBeenCalledTimes(1);
  });

  it('does not activate on a signed-out boot', () => {
    renderHook(() =>
      useSavingsReminderActivation({ ...ready, storeUser: null })
    );

    expect(mockActivate).not.toHaveBeenCalled();
  });

  it('activates when the user signs in after boot', () => {
    const { rerender } = renderHook(
      ({ storeUser }: { storeUser: { id: string } | null }) =>
        useSavingsReminderActivation({ ...ready, storeUser }),
      { initialProps: { storeUser: null as { id: string } | null } }
    );

    expect(mockActivate).not.toHaveBeenCalled();

    rerender({ storeUser: { id: 'user-a' } });

    expect(mockActivate).toHaveBeenCalledTimes(1);
  });

  it('waits for initialization before activating', () => {
    renderHook(() =>
      useSavingsReminderActivation({
        ...ready,
        isInitialized: false,
        storeUser: { id: 'user-a' },
      })
    );

    expect(mockActivate).not.toHaveBeenCalled();
  });

  it('does not retire any scope on mount', () => {
    renderHook(() =>
      useSavingsReminderActivation({ ...ready, storeUser: { id: 'user-a' } })
    );

    expect(mockCancelScope).not.toHaveBeenCalled();
  });

  it('retires the previous scope on account switch', () => {
    const { rerender } = renderHook(
      ({ storeUser }: { storeUser: { id: string } | null }) =>
        useSavingsReminderActivation({ ...ready, storeUser }),
      { initialProps: { storeUser: { id: 'user-a' } } }
    );
    expect(mockCancelScope).not.toHaveBeenCalled();

    rerender({ storeUser: { id: 'user-b' } });

    expect(mockCancelScope).toHaveBeenCalledTimes(1);
    expect(mockCancelScope).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      userId: 'user-a',
    });
  });

  it('retires the previous scope on sign-out', () => {
    const { rerender } = renderHook(
      ({ storeUser }: { storeUser: { id: string } | null }) =>
        useSavingsReminderActivation({ ...ready, storeUser }),
      { initialProps: { storeUser: { id: 'user-a' } } }
    );

    rerender({ storeUser: null });

    expect(mockCancelScope).toHaveBeenCalledTimes(1);
    expect(mockCancelScope).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      userId: 'user-a',
    });
  });

  it('does not retire anything when signing in from signed-out', () => {
    const { rerender } = renderHook(
      ({ storeUser }: { storeUser: { id: string } | null }) =>
        useSavingsReminderActivation({ ...ready, storeUser }),
      { initialProps: { storeUser: null as { id: string } | null } }
    );

    rerender({ storeUser: { id: 'user-a' } });

    expect(mockCancelScope).not.toHaveBeenCalled();
  });

  it('does not retire the scope when only readiness changes', () => {
    const { rerender } = renderHook(
      ({ isInitialized }: { isInitialized: boolean }) =>
        useSavingsReminderActivation({
          ...ready,
          isInitialized,
          storeUser: { id: 'user-a' },
        }),
      { initialProps: { isInitialized: false } }
    );

    rerender({ isInitialized: true });

    expect(mockCancelScope).not.toHaveBeenCalled();
  });
});
