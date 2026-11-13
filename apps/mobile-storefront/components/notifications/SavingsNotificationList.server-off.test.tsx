import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { SavingsNotificationList } from './SavingsNotificationList';

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
});
