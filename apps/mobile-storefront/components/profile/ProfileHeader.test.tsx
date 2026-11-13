import { resolve } from 'node:path';
import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Pressable } from 'react-native';
import { palette } from '@/constants/Colors';
import type { Customer } from '@/stores/auth-store';
import { ProfileHeader } from './ProfileHeader';

const mockGetMostRecentBadge = jest.fn((userId: string) =>
  userId === 'auth-user'
    ? {
        eventId: 'event-1',
        eventTitle: 'Today Quiz',
        label: 'SuperQuiz badge',
        unlockedAt: 100,
      }
    : null
);

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual(
    'react-native'
  ) as typeof import('react-native');
  return {
    __esModule: true,
    default: { View },
    FadeIn: { delay: () => ({ duration: () => ({}) }), duration: () => ({}) },
    FadeInDown: { delay: () => ({ duration: () => ({}) }) },
    FadeInRight: { delay: () => ({ duration: () => ({}) }) },
  };
});
jest.mock('@react-native-vector-icons/ionicons', () => 'Ionicons');
jest.mock('@/stores/quiz-badge-store', () => ({
  useQuizBadgeStore: (selector: (state: unknown) => unknown) =>
    selector({
      getMostRecentBadge: mockGetMostRecentBadge,
    }),
}));

const { cssInterop } = jest.requireActual<
  typeof import('react-native-css-interop')
>(
  resolve(
    __dirname,
    '../../../../node_modules/react-native-css-interop/dist/runtime/native/api.js'
  )
);
const NativeWindPressable = cssInterop(Pressable, { className: 'style' });

const customer: Customer = {
  email: 'player@example.test',
  id: 'customer-row-id',
  user_id: 'auth-user',
};

describe('ProfileHeader', () => {
  it('shows the most recently unlocked SuperQuiz badge for the account', () => {
    render(<ProfileHeader customer={customer} />);

    expect(screen.getByText('SuperQuiz badge')).toBeTruthy();
    expect(screen.getByText('Today Quiz')).toBeTruthy();
    expect(mockGetMostRecentBadge).toHaveBeenCalledWith('auth-user');
  });

  // On device NativeWind's interop ignored the Pressable style callback, so
  // Redeem lost its amber pill and showed dark text on dark red.
  it('keeps the Redeem pill fill and row layout through native interop', () => {
    render(<ProfileHeader customer={customer} loyaltyPoints={0} />);
    let button = screen.getByRole('button', {
      name: 'View wallet and redeem points',
    });
    while (
      button.parent?.props.accessibilityLabel ===
      'View wallet and redeem points'
    )
      button = button.parent;

    const native = render(<NativeWindPressable {...button.props} />);

    expect(
      native.getByRole('button', { name: 'View wallet and redeem points' })
    ).toHaveStyle({
      backgroundColor: palette.amber[400],
      flexDirection: 'row',
    });
  });
});
