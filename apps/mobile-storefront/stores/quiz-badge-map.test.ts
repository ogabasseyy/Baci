import { describe, expect, it } from '@jest/globals';
import { mergeQuizBadgeMaps } from './quiz-badge-map';

describe('mergeQuizBadgeMaps', () => {
  it('keeps the newest badge when persisted data is older', () => {
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

    expect(mergeQuizBadgeMaps(current, persisted)['user-a']['event-1']).toEqual(
      current['user-a']['event-1']
    );
  });

  it('adds persisted users and events without mutating current data', () => {
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
      'user-b': {
        'event-2': {
          eventId: 'event-2',
          eventTitle: 'Past Quiz',
          label: 'SuperQuiz badge' as const,
          unlockedAt: 100,
        },
      },
    };

    const merged = mergeQuizBadgeMaps(current, persisted);

    expect(merged).toEqual({ ...current, ...persisted });
    expect(current).toEqual({
      'user-a': { 'event-1': current['user-a']['event-1'] },
    });
  });
});
