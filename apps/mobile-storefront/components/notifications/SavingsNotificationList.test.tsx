import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type { SavingsNotification } from '@/schemas/savings-notifications';
import { SavingsNotificationList } from './SavingsNotificationList';

jest.mock('@shopify/flash-list', () => ({
  FlashList: ({
    data,
    ListEmptyComponent,
    ListHeaderComponent,
    renderItem,
  }: {
    data: Array<{ id: string }>;
    ListEmptyComponent: () => ReactNode;
    ListHeaderComponent: ReactNode;
    renderItem: (input: { item: { id: string } }) => ReactNode;
  }) => {
    const { View } = require('react-native') as typeof import('react-native');
    return (
      <View>
        {ListHeaderComponent}
        {data.length === 0
          ? ListEmptyComponent()
          : data.map((item) => (
              <View key={item.id}>{renderItem({ item })}</View>
            ))}
      </View>
    );
  },
}));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

const notification = {
  body: 'Your savings interest has been credited.',
  createdAt: '2026-09-25T10:00:00.000Z',
  goalId: '00000000-0000-4000-8000-000000000002',
  id: '00000000-0000-4000-8000-000000000001',
  readAt: null,
  title: 'Interest credited',
  type: 'savings_interest_credited',
};

describe('SavingsNotificationList', () => {
  it('renders a retry state rather than fabricated notifications after an inbox failure', () => {
    const onRetry = jest.fn<() => void>();
    render(
      <SavingsNotificationList
        header={null}
        isLoading={false}
        notifications={[]}
        onOpen={jest.fn<(item: SavingsNotification) => void>()}
        onRetry={onRetry}
        requestError="Offline"
      />
    );

    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('Offline')).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Interest credited' })
    ).toBeNull();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('opens a server-issued notification', () => {
    const onOpen = jest.fn<(item: SavingsNotification) => void>();
    render(
      <SavingsNotificationList
        header={null}
        isLoading={false}
        notifications={[notification]}
        onOpen={onOpen}
        onRetry={jest.fn<() => void>()}
        requestError={null}
      />
    );

    fireEvent.press(screen.getByRole('button', { name: 'Interest credited' }));

    expect(onOpen).toHaveBeenCalledWith(notification);
  });
});
