import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useQuizAccountChangeReset } from './useQuizAccountChangeReset';

const mockResetForAccountChange = jest.fn();
let mockUserId: string | null = 'user-a';

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: { user: { id: string } | null }) => unknown
  ) => selector({ user: mockUserId ? { id: mockUserId } : null }),
}));

jest.mock('@/stores/quiz-store', () => ({
  useQuizStore: (selector: (state: unknown) => unknown) =>
    selector({ resetForAccountChange: mockResetForAccountChange }),
}));

describe('useQuizAccountChangeReset', () => {
  it('resets in-memory state when the authenticated account changes', () => {
    const { rerender } = renderHook(
      ({ tick }: { tick: number }) => {
        void tick;
        return useQuizAccountChangeReset();
      },
      { initialProps: { tick: 0 } }
    );

    mockUserId = 'user-b';
    act(() => rerender({ tick: 1 }));

    expect(mockResetForAccountChange).toHaveBeenCalledTimes(1);
  });
});
