import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

const mockSetAuth = jest.fn<() => Promise<void>>();
const mockSubscribe = jest.fn();
const mockOn = jest.fn();
const mockChannel = jest.fn();
const mockRemoveChannel = jest.fn();
const mockRealtimeChannel = {
  on: mockOn,
  subscribe: mockSubscribe,
};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    channel: mockChannel,
    realtime: { setAuth: mockSetAuth },
    removeChannel: mockRemoveChannel,
  },
}));

const { useQuizResultRealtimeWakeup } =
  require('./use-quiz-result-realtime-wakeup') as typeof import('./use-quiz-result-realtime-wakeup');

describe('useQuizResultRealtimeWakeup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetAuth.mockResolvedValue();
    mockChannel.mockReturnValue(mockRealtimeChannel);
    mockOn.mockReturnValue(mockRealtimeChannel);
    mockSubscribe.mockReturnValue(mockRealtimeChannel);
  });

  it('refetches from a private wakeup channel and removes it on cleanup', async () => {
    const onWakeup = jest.fn();
    const { unmount } = renderHook(() =>
      useQuizResultRealtimeWakeup({
        enabled: true,
        eventId: 'event-1',
        onWakeup,
      })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSetAuth).toHaveBeenCalledTimes(1);
    expect(mockChannel).toHaveBeenCalledWith('quiz-results:event-1', {
      config: { private: true },
    });
    expect(mockOn).toHaveBeenCalledWith(
      'broadcast',
      { event: 'quiz_results_ready' },
      expect.any(Function)
    );

    const wakeup = mockOn.mock.calls[0]?.[2] as (() => void) | undefined;
    wakeup?.();
    expect(onWakeup).toHaveBeenCalledTimes(1);

    unmount();
    expect(mockRemoveChannel).toHaveBeenCalledWith(mockRealtimeChannel);
  });

  it('keeps polling as the fallback when Realtime authentication fails', async () => {
    mockSetAuth.mockRejectedValueOnce(new Error('offline'));

    renderHook(() =>
      useQuizResultRealtimeWakeup({
        enabled: true,
        eventId: 'event-1',
        onWakeup: jest.fn(),
      })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSetAuth).toHaveBeenCalledTimes(1);
    expect(mockChannel).not.toHaveBeenCalled();
  });
});
