import { fireEvent, render, screen } from '@testing-library/react-native';
import type { SavingsNotification } from '@/schemas/savings-notifications';
import { SavingsNotificationCard } from './SavingsNotificationCard';

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'dark',
}));

const notification: SavingsNotification = {
  id: '00000000-0000-4000-8000-000000000001',
  goalId: '00000000-0000-4000-8000-000000000002',
  type: 'first_contribution',
  title: 'Your first step is done!',
  body: 'Your first contribution is confirmed.',
  createdAt: '2026-10-24T13:58:17Z',
  readAt: null,
};

it('keeps notification text inside a padded row and opens the owned notification', () => {
  const onOpen = jest.fn();
  render(
    <SavingsNotificationCard
      notification={notification}
      label="First contribution"
      timestamp="24 Oct"
      onOpen={onOpen}
    />
  );

  const row = screen.getByRole('button', { name: 'First contribution' });
  expect(row).toHaveStyle({
    flexDirection: 'row',
    padding: 16,
    minHeight: 104,
  });
  expect(screen.getByText(notification.title)).toHaveProp('numberOfLines', 1);
  expect(screen.getByText(notification.title)).toHaveProp(
    'ellipsizeMode',
    'tail'
  );
  expect(screen.getByText(notification.body)).toBeOnTheScreen();
  fireEvent.press(row);
  expect(onOpen).toHaveBeenCalledWith(notification);
});

it('keeps read notifications visible without an unread accent', () => {
  render(
    <SavingsNotificationCard
      notification={{ ...notification, readAt: '2026-10-24T14:00:00Z' }}
      label="Read contribution"
      timestamp="24 Oct"
      onOpen={jest.fn()}
    />
  );

  const row = screen.getByRole('button', { name: 'Read contribution' });
  expect(row).not.toHaveStyle({ borderLeftWidth: 3 });
  expect(screen.getByText(notification.body)).toBeOnTheScreen();
});
