import { cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NegotiationsScreen from './negotiations';

type TestChannel = {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  channels: new Map<string, TestChannel>(),
  merchantId: 'merchant-1' as string | undefined,
  invalidateQueries: vi.fn(),
  removeChannel: vi.fn().mockResolvedValue('ok'),
  nextId: 0,
  focused: true,
  useQuery: vi.fn(),
}));

vi.mock('expo-router', () => ({ useIsFocused: () => mocks.focused }));

vi.mock('expo-crypto', () => ({
  randomUUID: () => `subscription-${++mocks.nextId}`,
}));
vi.mock('expo-haptics', () => ({}));
vi.mock('@react-native-vector-icons/ionicons', () => ({ default: () => null }));
vi.mock('@shopify/flash-list', () => ({ FlashList: () => null }));
vi.mock('react-native', () => ({
  ActivityIndicator: () => null,
  Alert: { alert: vi.fn() },
  Pressable: () => null,
  RefreshControl: () => null,
  Text: () => null,
  View: () => null,
}));
vi.mock('@/components/negotiations/NegotiationCard', () => ({
  NegotiationCard: () => null,
}));
vi.mock('@/components/negotiations/negotiation-evidence-actions', () => ({}));
vi.mock('@/components/negotiations/negotiations-screen.styles', () => ({
  negotiationScreenStyles: {},
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({
    merchant: mocks.merchantId ? { id: mocks.merchantId } : null,
    isLoading: true,
  }),
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }));
vi.mock('@/lib/api-client', () => ({ apiClient: vi.fn() }));
vi.mock('@tanstack/react-query', () => {
  const client = { invalidateQueries: mocks.invalidateQueries };
  return {
    useQueryClient: () => client,
    useQuery: mocks.useQuery,
    useMutation: () => ({ isPending: false }),
  };
});
vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (name: string) => {
      // Supabase reuses channels by topic and rejects new bindings after join.
      const existing = mocks.channels.get(name);
      if (existing) return existing;
      let subscribed = false;
      const channel: TestChannel = {
        on: vi.fn(() => {
          if (subscribed) {
            throw new Error(
              `cannot add postgres_changes callbacks for ${name} after subscribe()`
            );
          }
          return channel;
        }),
        subscribe: vi.fn(() => {
          subscribed = true;
          return channel;
        }),
      };
      mocks.channels.set(name, channel);
      return channel;
    },
    // Keep channels registered to model asynchronous unsubscribe still pending.
    removeChannel: mocks.removeChannel,
  },
}));

beforeEach(() => {
  mocks.channels.clear();
  mocks.focused = true;
  mocks.useQuery.mockReturnValue({
    data: [],
    isLoading: true,
    refetch: vi.fn(),
  });
  mocks.merchantId = 'merchant-1';
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('negotiation notification realtime lifecycle', () => {
  it('opens a second screen without rebinding an already subscribed channel', () => {
    const first = render(<NegotiationsScreen />);
    const firstChannel = [...mocks.channels.values()][0];

    const second = render(<NegotiationsScreen />);

    expect(mocks.channels.size).toBe(2);
    const secondChannel = [...mocks.channels.values()][1];
    first.unmount();
    expect(mocks.removeChannel).toHaveBeenCalledExactlyOnceWith(firstChannel);
    expect(mocks.removeChannel).not.toHaveBeenCalledWith(secondChannel);
    secondChannel.on.mock.calls[0][2]();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['negotiation_requests', 'merchant-1'],
    });
    second.unmount();
    expect(mocks.removeChannel).toHaveBeenLastCalledWith(secondChannel);
  });

  it('remounts safely while the previous channel removal is pending', () => {
    const first = render(<NegotiationsScreen />);
    first.unmount();

    render(<NegotiationsScreen />);

    expect(mocks.channels.size).toBe(2);
  });

  it('creates a fresh subscription when Strict Mode replays the effect', () => {
    render(
      <StrictMode>
        <NegotiationsScreen />
      </StrictMode>
    );

    expect(mocks.channels.size).toBe(2);
    expect(mocks.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('scopes updates to the current merchant and cleans up on merchant change', () => {
    const view = render(<NegotiationsScreen />);
    const firstChannel = [...mocks.channels.values()][0];
    mocks.merchantId = 'merchant-2';

    view.rerender(<NegotiationsScreen />);

    expect(mocks.removeChannel).toHaveBeenCalledWith(firstChannel);
    const channel = [...mocks.channels.values()][1];
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'negotiation_requests',
        filter: 'merchant_id=eq.merchant-2',
      },
      expect.any(Function)
    );
    channel.on.mock.calls[0][2]();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['negotiation_requests', 'merchant-2'],
    });
  });

  it('releases the subscription on blur and ignores late events while still mounted', () => {
    const view = render(<NegotiationsScreen />);
    const channel = [...mocks.channels.values()][0];
    mocks.focused = false;
    view.rerender(<NegotiationsScreen />);
    expect(mocks.removeChannel).toHaveBeenCalledExactlyOnceWith(channel);
    mocks.invalidateQueries.mockClear();
    channel.on.mock.calls[0][2]();
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });

  it('subscribes with a fresh channel and refreshes missed updates on refocus', () => {
    const view = render(<NegotiationsScreen />);
    mocks.focused = false;
    view.rerender(<NegotiationsScreen />);
    mocks.invalidateQueries.mockClear();
    mocks.focused = true;
    view.rerender(<NegotiationsScreen />);
    expect(mocks.channels.size).toBe(2);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['negotiation_requests', 'merchant-1'],
    });
  });

  it('does not subscribe when mounted without focus', () => {
    mocks.focused = false;
    render(<NegotiationsScreen />);
    expect(mocks.channels.size).toBe(0);
    expect(mocks.useQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it('does not subscribe without a merchant', () => {
    mocks.merchantId = undefined;
    render(<NegotiationsScreen />);
    expect(mocks.channels.size).toBe(0);
  });
});
