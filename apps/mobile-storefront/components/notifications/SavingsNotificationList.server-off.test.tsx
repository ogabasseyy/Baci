import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import {
  CHAT_WIDGET_DEFAULT_BOTTOM_OFFSET,
  CHAT_WIDGET_FAB_SIZE,
} from '@/constants/layout';
import {
  NOTIFICATIONS_BOTTOM_INSET,
  SavingsNotificationList,
} from './SavingsNotificationList';

jest.mock('@shopify/flash-list', () => ({
  FlashList: ({
    data,
    ListEmptyComponent,
    ListFooterComponent,
  }: {
    data: unknown[];
    ListEmptyComponent: () => ReactNode;
    ListFooterComponent?: ReactNode;
  }) => {
    const { View } = require('react-native') as typeof import('react-native');
    return (
      <View>
        {data.length === 0 ? ListEmptyComponent() : null}
        {ListFooterComponent}
      </View>
    );
  },
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

// With PiggyVest off the inbox request fails: the list offers a retry and
// still shows its footer (the orders link) below, never on top of it.
describe('savings notification list with the server off', () => {
  it('shows the retry state with the footer after it', () => {
    render(
      <SavingsNotificationList
        header={null}
        footer={<Text>orders-footer</Text>}
        isLoading={false}
        notifications={[]}
        onOpen={jest.fn()}
        onRetry={jest.fn()}
        requestError="Savings notifications are unavailable."
      />
    );
    expect(screen.getByText('orders-footer')).toBeTruthy();
    expect(screen.queryByText('No savings updates yet')).toBeNull();
  });

  // Walk 14: "View your orders" sat behind the floating AI button.
  it('keeps the footer above the floating AI button band', () => {
    expect(NOTIFICATIONS_BOTTOM_INSET).toBeGreaterThan(
      CHAT_WIDGET_DEFAULT_BOTTOM_OFFSET + CHAT_WIDGET_FAB_SIZE
    );
  });
});
