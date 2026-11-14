import { describe, expect, it } from '@jest/globals';
import type {
  QuizLeaderboard,
  QuizLeaderboardEntry,
} from '@/services/quiz-types';
import { buildQuizStandingsView } from './quiz-standings-view';

function entry(
  rank: number,
  overrides: Partial<QuizLeaderboardEntry> = {}
): QuizLeaderboardEntry {
  return {
    displayName: `player${rank}`,
    isCurrentCustomer: false,
    rank,
    score: 100 - rank,
    status: 'scored',
    submittedAt: null,
    totalTimeSeconds: 30 + rank,
    ...overrides,
  };
}

function board(
  ranks: number[],
  currentPlayer: QuizLeaderboardEntry | null = null
): QuizLeaderboard {
  return {
    currentPlayer,
    entries: ranks.map((rank) =>
      currentPlayer?.rank === rank ? currentPlayer : entry(rank)
    ),
    participantCount: ranks.length,
    status: 'live',
  };
}

describe('buildQuizStandingsView', () => {
  it('returns nothing to draw without a board', () => {
    expect(buildQuizStandingsView(null)).toEqual({
      podium: [],
      rows: [],
      pointsBehindTopTen: null,
    });
  });

  it('puts the top three on the podium and the next two below', () => {
    const view = buildQuizStandingsView(board([1, 2, 3, 4, 5, 6, 7]));
    expect(view.podium.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(view.rows.map((item) => item.rank)).toEqual([4, 5]);
  });

  it('lists everyone as rows when fewer than three people have played', () => {
    const view = buildQuizStandingsView(board([1, 2]));
    expect(view.podium).toEqual([]);
    expect(view.rows.map((item) => item.rank)).toEqual([1, 2]);
  });

  it('keeps a podium player on the podium without repeating them', () => {
    const me = entry(2, { isCurrentCustomer: true });
    const view = buildQuizStandingsView(board([1, 2, 3, 4], me));
    expect(view.podium.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(view.rows.map((item) => item.rank)).toEqual([4]);
    expect(view.pointsBehindTopTen).toBeNull();
  });

  it('shows rank 37 with the players directly above and below', () => {
    const me = entry(37, { displayName: 'me', isCurrentCustomer: true });
    const ranks = Array.from({ length: 40 }, (_, index) => index + 1);
    const view = buildQuizStandingsView(board(ranks, me));
    expect(view.podium.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(view.rows.map((item) => item.rank)).toEqual([36, 37, 38]);
    expect(view.rows[1]?.isCurrentCustomer).toBe(true);
    expect(view.pointsBehindTopTen).toBe(27);
  });

  it('shows a low-ranked player alone when the board only lists the top', () => {
    const me = entry(37, { displayName: 'me', isCurrentCustomer: true });
    const view = buildQuizStandingsView({
      ...board([1, 2, 3, 4, 5]),
      currentPlayer: me,
    });
    expect(view.rows.map((item) => item.rank)).toEqual([37]);
    expect(view.pointsBehindTopTen).toBeNull();
  });

  it('bugfix: two tied neighbours sharing a name were merged into one row', () => {
    const me = entry(37, { displayName: 'me', isCurrentCustomer: true });
    const view = buildQuizStandingsView({
      currentPlayer: me,
      entries: [
        entry(1),
        entry(2),
        entry(3),
        entry(36, { displayName: 'Ada' }),
        entry(36, { displayName: 'Ada', totalTimeSeconds: 99 }),
        me,
      ],
      participantCount: 40,
      status: 'live',
    });
    expect(view.rows.map((item) => item.displayName)).toEqual([
      'Ada',
      'Ada',
      'me',
    ]);
  });

  it('bugfix: a tie that skips rank 10 hid the gap to the top ten', () => {
    const me = entry(12, { isCurrentCustomer: true, score: 80 });
    const ranks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 11, 12];
    const view = buildQuizStandingsView(board(ranks, me));
    expect(view.pointsBehindTopTen).toBe(11);
  });

  it("keeps the player's own flagged row when a namesake shares their rank", () => {
    const me = entry(4, { displayName: 'Ada', isCurrentCustomer: true });
    const view = buildQuizStandingsView({
      currentPlayer: me,
      entries: [
        entry(1),
        entry(2),
        entry(3),
        entry(4, { displayName: 'Ada' }),
        me,
        entry(6),
      ],
      participantCount: 6,
      status: 'live',
    });
    expect(view.rows.map((row) => row.isCurrentCustomer)).toEqual([
      false,
      true,
    ]);
  });

  it('never reports a negative gap to the top ten', () => {
    const me = entry(11, { isCurrentCustomer: true, score: 95 });
    const ranks = Array.from({ length: 12 }, (_, index) => index + 1);
    expect(buildQuizStandingsView(board(ranks, me)).pointsBehindTopTen).toBe(0);
  });
});
