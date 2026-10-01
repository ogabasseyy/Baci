import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
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
});
