import type {
  QuizLeaderboard,
  QuizLeaderboardEntry,
} from '@/services/quiz-types';

const PODIUM_SIZE = 3;
const TOP_ROWS_END_RANK = 5;
const TOP_TEN_RANK = 10;

export interface QuizStandingsView {
  /** Ranks 1 to 3 when the board has all three; otherwise empty. */
  podium: QuizLeaderboardEntry[];
  /** Rows under the podium: the next ranks, or the player and their neighbours. */
  rows: QuizLeaderboardEntry[];
  /** How far a player outside the top ten is from tenth place, when known. */
  pointsBehindTopTen: number | null;
}

function isSameEntry(
  first: QuizLeaderboardEntry,
  second: QuizLeaderboardEntry
): boolean {
  return first.rank === second.rank && first.displayName === second.displayName;
}

/**
 * Decides what a player sees on the standings: the podium, then either the
 * next ranks (when they are near the top) or their own row with whoever sits
 * directly above and below them, so rank 37 still sees where they stand.
 */
export function buildQuizStandingsView(
  leaderboard: QuizLeaderboard | null
): QuizStandingsView {
  if (!leaderboard) return { podium: [], rows: [], pointsBehindTopTen: null };
  const entries = [...leaderboard.entries].sort((a, b) => a.rank - b.rank);
  const currentPlayer =
    leaderboard.currentPlayer ??
    entries.find((entry) => entry.isCurrentCustomer) ??
    null;
  const hasPodium = entries.length >= PODIUM_SIZE;
  const podium = hasPodium ? entries.slice(0, PODIUM_SIZE) : [];
  const afterPodium = hasPodium ? entries.slice(PODIUM_SIZE) : entries;
  const nextRanks = afterPodium.filter(
    (entry) => entry.rank <= TOP_ROWS_END_RANK
  );

  // When the board flags the player's own row, trust only that flag: another
  // person can share their name and rank. The name match is for boards that
  // do not flag rows at all.
  const boardFlagsPlayer = entries.some((entry) => entry.isCurrentCustomer);
  const playerIsShown =
    !currentPlayer ||
    [...podium, ...nextRanks].some((entry) =>
      boardFlagsPlayer
        ? entry.isCurrentCustomer
        : isSameEntry(entry, currentPlayer)
    );
  if (playerIsShown || !currentPlayer) {
    return { podium, rows: nextRanks, pointsBehindTopTen: null };
  }

  const neighbours = entries.filter(
    (entry) =>
      Math.abs(entry.rank - currentPlayer.rank) === 1 &&
      !entry.isCurrentCustomer &&
      !podium.includes(entry)
  );
  // Neighbours sit exactly one rank away, so none can be the player's own
  // row. They are never de-duplicated by name: two different players can
  // share a display name at a tied rank and both must stay visible.
  const rows = [
    ...neighbours,
    { ...currentPlayer, isCurrentCustomer: true },
  ].sort((a, b) => a.rank - b.rank);
  // The lowest-placed player still inside the top ten, not "rank 10": ties
  // can skip that rank (8, 8, 11 or 9, 9, 11) and the gap must still be
  // reported. Only a board that lists past the top ten can tell.
  const lastInTopTen = entries
    .filter((entry) => entry.rank <= TOP_TEN_RANK)
    .at(-1);
  const boardCoversTopTen = entries.some(
    (entry) => entry.rank > TOP_TEN_RANK && !isSameEntry(entry, currentPlayer)
  );
  const pointsBehindTopTen =
    lastInTopTen &&
    (boardCoversTopTen || entries.length >= TOP_TEN_RANK) &&
    currentPlayer.rank > TOP_TEN_RANK
      ? Math.max(0, lastInTopTen.score - currentPlayer.score)
      : null;
  return { podium, rows, pointsBehindTopTen };
}
