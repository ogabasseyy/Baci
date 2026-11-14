import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { ActivityQueryWrapper } from '@/components/wallet/activity/activity-test-harness.test-support';
import { usePiggyvestWalletActivity } from './use-piggyvest-wallet-activity';

const mockFetch = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('@/lib/piggyvest-wallet-activity', () => ({
  fetchPiggyvestWalletActivity: (...args: unknown[]) => mockFetch(...args),
}));
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (select: (state: { user: null }) => unknown) =>
    select({ user: null }),
}));

describe('PiggyVest wallet activity hook with the server keeping PiggyVest off', () => {
  it('asks for nothing while disabled or signed out', () => {
    const { result } = renderHook(
      () =>
        usePiggyvestWalletActivity({
          merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
          enabled: false,
        }),
      { wrapper: ActivityQueryWrapper }
    );

    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
