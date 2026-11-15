import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';
import AccountScreen from '@/app/(tabs)/account';

type MockScrollStyleOptions = { includeBottomInset?: boolean };
type MockCustomer = { email: string; id: string; loyalty_points?: number };
type MockSession = {
  user: { email: string; id: string; user_metadata: Record<string, unknown> };
};
type MockRealtimePayload = { new?: Record<string, unknown> };
type MockRealtimeChannel = {
  on: jest.MockedFunction<
    (
      type: string,
      filter: Record<string, unknown>,
      callback: (payload: MockRealtimePayload) => void
    ) => MockRealtimeChannel
  >;
  subscribe: jest.MockedFunction<() => MockRealtimeChannel>;
  subscribed: boolean;
  topic: string;
};

const mockStorefrontScreenShell = jest.fn(
  ({ children }: { children?: React.ReactNode; edges?: string[] }) => (
    <View testID="storefront-screen-shell">{children}</View>
  )
);
const mockGetScrollContentStyle =
  jest.fn<
    (options?: MockScrollStyleOptions) => {
      paddingTop: number;
      paddingBottom: number;
    }
  >();
const mockUseStorefrontInsets = jest.fn();
const mockUseMerchant = jest.fn();
const mockUseAuthStatus = jest.fn();
const mockGetAccountMenuSections = jest.fn();
const mockRouterReplace = jest.fn();
const mockRouterPush = jest.fn();
const mockRemoveChannel = jest.fn(async (channel: MockRealtimeChannel) => {
  mockRealtimeChannels.delete(channel.topic);
  channel.subscribed = false;
  return 'ok';
});
const mockSupabaseChannel = jest.fn((topic: string) =>
  getMockRealtimeChannel(topic)
);
const mockGetChannels = jest.fn(() =>
  Array.from(mockRealtimeChannels.values())
);
const mockCustomerMaybeSingle = jest.fn(async () => ({
  data: { loyalty_points: 25 },
  error: null,
}));
let mockCustomer: MockCustomer | null = null;
let mockSession: MockSession | null = {
  user: {
    id: 'user-1',
    email: 'merchant@example.com',
    user_metadata: {},
  },
};
const mockSignOut = jest.fn(async () => undefined);
const mockRealtimeChannels = new Map<string, MockRealtimeChannel>();

function getMockRealtimeChannel(topic: string): MockRealtimeChannel {
  const existingChannel = mockRealtimeChannels.get(topic);
  if (existingChannel) {
    return existingChannel;
  }

  const channel = {
    on: jest.fn(
      (
        _type: string,
        _filter: Record<string, unknown>,
        _callback: (payload: MockRealtimePayload) => void
      ) => {
        if (channel.subscribed) {
          throw new Error(
            `cannot add postgres_changes callbacks for realtime:${topic} after subscribe().`
          );
        }
        return channel;
      }
    ),
    subscribe: jest.fn(() => {
      channel.subscribed = true;
      return channel;
    }),
    subscribed: false,
    topic,
  };

  mockRealtimeChannels.set(topic, channel);
  return channel;
}

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: unknown }) => {
    mockRouterReplace(href);
    return null;
  },
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
  },
}));

jest.mock('expo-router/react-navigation', () => ({
  useIsFocused: () => true,
}));

jest.mock('@/components/storefront/StorefrontScreenShell', () => ({
  StorefrontScreenShell: ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
  }) => mockStorefrontScreenShell({ children, ...props }),
}));

jest.mock('@/hooks/use-storefront-insets', () => ({
  useStorefrontInsets: () => mockUseStorefrontInsets(),
}));

jest.mock('@/hooks', () => ({
  useMerchant: () => mockUseMerchant(),
}));

jest.mock('@/hooks/use-auth-guard', () => ({
  useAuthStatus: () => mockUseAuthStatus(),
}));

jest.mock('@/components/profile/account-menu', () => ({
  getAccountMenuSections: (...args: unknown[]) =>
    mockGetAccountMenuSections(...args),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (topic: string) => mockSupabaseChannel(topic),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mockCustomerMaybeSingle,
        }),
      }),
    }),
    getChannels: () => mockGetChannels(),
    removeChannel: (channel: MockRealtimeChannel) => mockRemoveChannel(channel),
  },
}));

jest.mock('@/components/profile/MenuSection', () => ({
  MenuSection: ({ title }: { title: string }) => {
    const React = jest.requireActual('react') as typeof import('react');
    const { Text } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');

    return React.createElement(Text, null, title);
  },
}));

jest.mock('@/components/profile/ProfileHeader', () => ({
  ProfileHeader: ({ loyaltyPoints }: { loyaltyPoints?: number }) => {
    const React = jest.requireActual('react') as typeof import('react');
    const { Text, View } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');

    return React.createElement(
      View,
      { testID: 'profile-header' },
      React.createElement(Text, null, `loyalty:${loyaltyPoints ?? 'none'}`)
    );
  },
}));

jest.mock('@/components/profile/SocialLinks', () => ({
  SocialLinks: () => {
    const React = jest.requireActual('react') as typeof import('react');
    const { View } = jest.requireActual(
      'react-native'
    ) as typeof import('react-native');

    return React.createElement(View, { testID: 'social-links' });
  },
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: {
      customer: MockCustomer | null;
      session: MockSession | null;
      signOut: () => Promise<void>;
    }) => unknown
  ) =>
    selector({
      customer: mockCustomer,
      session: mockSession,
      signOut: mockSignOut,
    }),
}));

describe('AccountScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCustomer = null;
    mockSession = {
      user: {
        id: 'user-1',
        email: 'merchant@example.com',
        user_metadata: {},
      },
    };
    mockRealtimeChannels.clear();
    mockCustomerMaybeSingle.mockResolvedValue({
      data: { loyalty_points: 25 },
      error: null,
    });
    mockGetScrollContentStyle.mockImplementation(
      (options?: MockScrollStyleOptions) => ({
        paddingTop: 20,
        paddingBottom: options?.includeBottomInset === false ? 60 : 94,
      })
    );
    mockUseStorefrontInsets.mockReturnValue({
      getScrollContentStyle: mockGetScrollContentStyle,
      getListContentStyle: jest.fn(),
    });
    mockUseMerchant.mockReturnValue({
      data: { social_media: null, phone: null },
    });
    mockUseAuthStatus.mockReturnValue({
      isInitialized: true,
      user: { id: 'user-1' },
    });
    mockGetAccountMenuSections.mockReturnValue([
      {
        title: 'Account',
        visible: true,
        items: [],
      },
    ]);
  });

  it('uses the storefront shell and scroll padding helper for the account layout', () => {
    render(<AccountScreen />);
    const shellProps = mockStorefrontScreenShell.mock.calls[0]?.[0];
    const scrollView = screen.getByTestId('account-scrollview');

    expect(shellProps?.edges).toEqual(['top']);
    expect(mockGetScrollContentStyle).toHaveBeenCalledWith({
      includeBottomInset: false,
    });
    expect(scrollView.props.contentContainerStyle).toEqual({
      paddingTop: 20,
      paddingBottom: 60,
    });
  });

  it('renders a placeholder before auth initialization completes', () => {
    mockUseAuthStatus.mockReturnValue({
      isInitialized: false,
      user: null,
    });

    const view = render(<AccountScreen />);

    expect(view.toJSON()).not.toBeNull();
    expect(mockStorefrontScreenShell).not.toHaveBeenCalled();
    expect(screen.queryByTestId('account-scrollview')).toBeNull();
  });

  it('redirects signed-out deep links to login with an account return path', () => {
    mockUseAuthStatus.mockReturnValue({
      isInitialized: true,
      user: null,
    });

    const view = render(<AccountScreen />);

    expect(view.toJSON()).toBeNull();
    expect(mockRouterReplace).toHaveBeenCalledWith({
      pathname: '/auth/login',
      params: { returnTo: '/(tabs)/account' },
    });
    expect(mockStorefrontScreenShell).not.toHaveBeenCalled();
  });

  it('filters out hidden menu sections before rendering', () => {
    mockGetAccountMenuSections.mockReturnValue([
      {
        title: 'Visible Section',
        visible: true,
        items: [],
      },
      {
        title: 'Hidden Section',
        visible: false,
        items: [],
      },
    ]);

    render(<AccountScreen />);

    expect(screen.getByText('Visible Section')).toBeTruthy();
    expect(screen.queryByText('Hidden Section')).toBeNull();
  });

  it('reuses a stable loyalty realtime channel after quick remount cleanup', async () => {
    mockCustomer = {
      id: 'customer-1',
      email: 'customer@example.com',
      loyalty_points: 10,
    };

    const firstRender = render(<AccountScreen />);
    await waitFor(() => expect(mockSupabaseChannel).toHaveBeenCalledTimes(1));
    firstRender.unmount();

    expect(() => render(<AccountScreen />)).not.toThrow();
    await waitFor(() => expect(mockSupabaseChannel).toHaveBeenCalledTimes(2));

    const firstTopic = mockSupabaseChannel.mock.calls[0]?.[0];
    const secondTopic = mockSupabaseChannel.mock.calls[1]?.[0];

    expect(firstTopic).toBe('account-loyalty-customer-1');
    expect(secondTopic).toBe(firstTopic);
    expect(mockGetChannels).toHaveBeenCalled();
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
  });

  it('refreshes loyalty points when the account screen is focused', async () => {
    mockCustomer = {
      id: 'customer-1',
      email: 'customer@example.com',
      loyalty_points: 10,
    };

    render(<AccountScreen />);

    await waitFor(() =>
      expect(mockCustomerMaybeSingle).toHaveBeenCalledTimes(1)
    );
    expect(screen.getByText('loyalty:25')).toBeTruthy();
  });
});
