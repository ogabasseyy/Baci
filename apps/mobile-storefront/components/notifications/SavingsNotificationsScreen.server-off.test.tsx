import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text } from 'react-native';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@shopify/flash-list', () => ({
  FlashList: ({
    ListEmptyComponent,
    ListFooterComponent,
  }: {
    ListEmptyComponent: () => ReactNode;
    ListFooterComponent?: ReactNode;
  }) => {
    const { View } = require('react-native') as typeof import('react-native');
    return (
      <View>
        {ListEmptyComponent()}
        {ListFooterComponent}
      </View>
    );
  },
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('@/hooks/use-savings-notification-inbox', () => ({
  useSavingsNotificationInbox: () => ({
    actionError: null,
    error: 'Savings notifications are unavailable.',
    isLoading: false,
    isSaving: false,
    markRead: jest.fn(),
    notifications: [],
    preferences: null,
    retry: jest.fn(),
    updatePreferences: jest.fn(),
  }),
}));

const { SavingsNotificationsScreen } =
  require('./SavingsNotificationsScreen') as typeof import('./SavingsNotificationsScreen');

// With PiggyVest off the inbox has no preferences and no notifications: the
// screen shows no settings, and the footer handed in still renders.
describe('savings notifications screen with the server off', () => {
  it('passes the footer through to the list', () => {
    render(
      <SavingsNotificationsScreen
        merchantId="m-1"
        userId="u-1"
        footer={<Text>orders-footer</Text>}
      />
    );
    expect(screen.getByText('orders-footer')).toBeTruthy();
    expect(screen.queryByText('Quiet hours')).toBeNull();
  });
});
