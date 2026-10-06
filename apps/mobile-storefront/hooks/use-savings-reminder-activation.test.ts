import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { activateDueSavingsReminderSafely } from '@/services/activate-savings-reminder-safely';
import { useSavingsReminderActivation } from './use-savings-reminder-activation';

jest.mock('@/services/activate-savings-reminder-safely', () => ({
  activateDueSavingsReminderSafely: jest.fn(),
}));

const mockActivate = activateDueSavingsReminderSafely as jest.MockedFunction<
  typeof activateDueSavingsReminderSafely
>;

const ready = {
  isInitialized: true,
  isStorageReady: true,
  isTrackingAuthorizationSettled: true,
};

describe('useSavingsReminderActivation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
