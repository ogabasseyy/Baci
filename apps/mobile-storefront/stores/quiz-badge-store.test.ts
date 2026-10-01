import { beforeEach, describe, expect, it } from '@jest/globals';
import { mergeQuizBadgeMaps } from './quiz-badge-map';
import { useQuizBadgeStore } from './quiz-badge-store';

describe('quiz badge persistence', () => {
  beforeEach(() => {
    useQuizBadgeStore.setState({ badgesByUser: {} });
  });

  it('isolates unlocked badges by authenticated user and event', () => {
    useQuizBadgeStore
      .getState()
      .unlockBadge('user-a', 'event-1', 'Morning Quiz', 100);

    expect(
      useQuizBadgeStore.getState().getMostRecentBadge('user-a')
    ).toMatchObject({ eventId: 'event-1', eventTitle: 'Morning Quiz' });
    expect(
      useQuizBadgeStore.getState().getMostRecentBadge('user-b')
    ).toBeNull();
    expect(
      useQuizBadgeStore.getState().getBadge('user-a', 'event-2')
    ).toBeNull();
  });

  it('returns the most recently unlocked badge for one account', () => {
    useQuizBadgeStore
      .getState()
      .unlockBadge('user-a', 'event-1', 'Earlier Quiz', 100);
    useQuizBadgeStore
      .getState()
      .unlockBadge('user-a', 'event-2', 'Today Quiz', 200);

    expect(
      useQuizBadgeStore.getState().getMostRecentBadge('user-a')
    ).toMatchObject({ eventId: 'event-2', eventTitle: 'Today Quiz' });
  });

  it('does not let late persisted hydration overwrite a newer in-memory unlock', () => {
    const current = {
      'user-a': {
        'event-1': {
          eventId: 'event-1',
          eventTitle: 'Today Quiz',
          label: 'SuperQuiz badge' as const,
          unlockedAt: 200,
        },
      },
    };
    const persisted = {
      'user-a': {
        'event-1': {
          eventId: 'event-1',
          eventTitle: 'Old Quiz',
          label: 'SuperQuiz badge' as const,
          unlockedAt: 100,
        },
      },
    };

    expect(
      mergeQuizBadgeMaps(current, persisted)['user-a']['event-1']
    ).toMatchObject({
      eventTitle: 'Today Quiz',
      unlockedAt: 200,
    });
  });
});
