import { describe, expect, it } from 'vitest';
import {
  quizLeaderboardProjectionSchema,
  quizLeaderboardQuerySchema,
  quizLeaderboardResponseSchema,
  quizLeaderboardRowSchema,
} from './quiz-leaderboard';

const ROW = {
  customer_name: 'Player-A1B2C3D4',
  is_current_customer: false,
  rank: 1,
  score: 5,
  status: 'scored',
  submitted_at: '2026-07-14T09:00:00.000Z',
  total_time_seconds: 30.5,
};

const ENTRY = {
  displayName: 'Player-A1B2C3D4',
  isCurrentCustomer: false,
  rank: 1,
  score: 5,
  status: 'scored',
  submittedAt: '2026-07-14T09:00:00.000Z',
  totalTimeSeconds: 30.5,
};

describe('quiz leaderboard schemas', () => {
  it('accepts a published top 100 projection and separate current player', () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      ...ROW,
      rank: index + 1,
    }));

    expect(
      quizLeaderboardProjectionSchema.parse({
        current_player: { ...ROW, is_current_customer: true, rank: '101' },
        entries: rows,
        status: 'published',
      }).current_player?.rank
    ).toBe('101');
  });

  it('accepts a hidden board only when no player data is present', () => {
    expect(
      quizLeaderboardResponseSchema.parse({
        currentPlayer: null,
        entries: [],
        participantCount: null,
        status: 'live_hidden',
      })
    ).toEqual({
      currentPlayer: null,
      entries: [],
      participantCount: null,
      status: 'live_hidden',
    });
  });

  it('rejects more than 100 public entries', () => {
    expect(
      quizLeaderboardResponseSchema.safeParse({
        currentPlayer: null,
        entries: Array.from({ length: 101 }, (_, index) => ({
          ...ENTRY,
          rank: index + 1,
        })),
        status: 'published',
      }).success
    ).toBe(false);
  });

  it('strips internal identifiers from a safe row', () => {
    const parsed = quizLeaderboardRowSchema.parse({
      ...ROW,
      attempt_id: 'secret-attempt',
      customer_id: 'secret-customer',
    });

    expect(parsed).not.toHaveProperty('attempt_id');
    expect(parsed).not.toHaveProperty('customer_id');
  });

  it('requires an event UUID', () => {
    expect(
      quizLeaderboardQuerySchema.safeParse({
        eventId: '11111111-1111-4111-8111-111111111111',
      }).success
    ).toBe(true);
    expect(
      quizLeaderboardQuerySchema.safeParse({ eventId: 'not-a-uuid' }).success
    ).toBe(false);
  });
});
