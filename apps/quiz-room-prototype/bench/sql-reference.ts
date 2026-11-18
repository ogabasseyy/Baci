import type {
  QuizAttemptBundle,
  QuizEventConfig,
  QuizRoomSealMode,
} from '../src/contracts';

export interface ReferenceRankedStanding {
  rank: number;
  attemptId: string;
  customerId: string;
  userId: string;
  score: number;
  elapsedMs: number;
  submittedAtMs: number;
}

export interface ReferenceAdjudicationOutput {
  standings: readonly ReferenceRankedStanding[];
  awardCount: number;
  winnerAttemptId: string | null;
  winnerCustomerId: string | null;
}

export interface RankChangeDiff {
  attemptId: string;
  customerId: string;
  persistedCloseRank: number;
  scheduledEndRank: number;
  persistedCloseElapsedMs: number;
  scheduledEndElapsedMs: number;
}

/**
 * Computes exact SQL-reference score for an attempt bundle under
 * `submit_quiz_answer_v2` / `private.terminalize_quiz_event_attempts_v2`:
 * - question credit requires non-timeout, matching answer hash, and
 *   `receivedAtMs <= LEAST(issuedAtMs + limitMs, closeCutoffMs)`
 * - partial/unsubmitted attempts use `closeCutoffMs` as `submittedAtMs`
 */
export function computeSqlReferenceBundleOutcome(
  bundle: QuizAttemptBundle,
  config: QuizEventConfig,
  closeCutoffMs: number
): {
  score: number;
  submittedAtMs: number;
  elapsedMs: number;
} {
  const variantById = new Map<string, string>();
  for (const slot of config.slots) {
    for (const variant of slot.variants) {
      variantById.set(variant.id, variant.answerKeyHash);
    }
  }
  const limitMs = config.timePerQuestionSeconds * 1000;
  let score = 0;

  for (const ans of bundle.answers) {
    if (ans.timeout || !ans.selectedAnswerHash) continue;
    const expectedHash = variantById.get(ans.variantId);
    if (!expectedHash || expectedHash !== ans.selectedAnswerHash) continue;
    const effectiveDeadlineMs = Math.min(
      ans.issuedAtMs + limitMs,
      closeCutoffMs
    );
    if (ans.receivedAtMs <= effectiveDeadlineMs) {
      score += 1;
    }
  }

  const submittedAtMs =
    bundle.closeReason === 'completed'
      ? bundle.submittedAtMs
      : Math.max(bundle.startedAtMs, closeCutoffMs);
  const elapsedMs = Math.max(0, submittedAtMs - bundle.startedAtMs);

  return { score, submittedAtMs, elapsedMs };
}

/**
 * Exact TypeScript reference implementation of `private.quiz_ranked_candidates_v2`
 * (`20260812183000_quiz_millisecond_tiebreak_alias_fix.sql`):
 * - Filters out blocked, disqualified, and revoked attempts
 * - Selects best attempt per customer (`score DESC, elapsedMs ASC, submittedAtMs ASC, attemptId ASC`)
 * - Orders final leaderboard identically and yields 1 award unless cancelled
 */
export function adjudicateReferenceStandings(options: {
  bundles: readonly QuizAttemptBundle[];
  config: QuizEventConfig;
  closeCutoffMs: number;
  sealMode: QuizRoomSealMode;
  blockedAttemptIds?: ReadonlySet<string>;
  disqualifiedAttemptIds?: ReadonlySet<string>;
  revokedCustomerIds?: ReadonlySet<string>;
}): ReferenceAdjudicationOutput {
  if (options.sealMode === 'cancelled') {
    return {
      standings: [],
      awardCount: 0,
      winnerAttemptId: null,
      winnerCustomerId: null,
    };
  }

  const bestByCustomer = new Map<
    string,
    {
      attemptId: string;
      customerId: string;
      userId: string;
      score: number;
      elapsedMs: number;
      submittedAtMs: number;
    }
  >();

  for (const bundle of options.bundles) {
    if (options.blockedAttemptIds?.has(bundle.attemptId)) continue;
    if (options.disqualifiedAttemptIds?.has(bundle.attemptId)) continue;
    if (options.revokedCustomerIds?.has(bundle.customerId)) continue;
    if (
      bundle.closeReason === 'event_cancelled' ||
      bundle.closeReason === 'disqualified' ||
      bundle.closeReason === 'tester_revoked'
    ) {
      continue;
    }

    const outcome = computeSqlReferenceBundleOutcome(
      bundle,
      options.config,
      options.closeCutoffMs
    );
    const candidate = {
      attemptId: bundle.attemptId,
      customerId: bundle.customerId,
      userId: bundle.userId,
      score: outcome.score,
      elapsedMs: outcome.elapsedMs,
      submittedAtMs: outcome.submittedAtMs,
    };

    const existing = bestByCustomer.get(bundle.customerId);
    if (!existing || compareStandingRows(candidate, existing) < 0) {
      bestByCustomer.set(bundle.customerId, candidate);
    }
  }

  const sorted = [...bestByCustomer.values()].sort(compareStandingRows);
  const standings: ReferenceRankedStanding[] = sorted.map((row, index) => ({
    rank: index + 1,
    attemptId: row.attemptId,
    customerId: row.customerId,
    userId: row.userId,
    score: row.score,
    elapsedMs: row.elapsedMs,
    submittedAtMs: row.submittedAtMs,
  }));

  const winner = standings[0] ?? null;
  return {
    standings,
    awardCount: winner ? 1 : 0,
    winnerAttemptId: winner?.attemptId ?? null,
    winnerCustomerId: winner?.customerId ?? null,
  };
}

export function compareStandingRows(
  a: {
    score: number;
    elapsedMs: number;
    submittedAtMs: number;
    attemptId: string;
  },
  b: {
    score: number;
    elapsedMs: number;
    submittedAtMs: number;
    attemptId: string;
  }
): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
  if (a.submittedAtMs !== b.submittedAtMs)
    return a.submittedAtMs - b.submittedAtMs;
  if (a.attemptId < b.attemptId) return -1;
  if (a.attemptId > b.attemptId) return 1;
  return 0;
}

export function diffCloseTimestampRankings(
  persistedStandings: readonly ReferenceRankedStanding[],
  scheduledStandings: readonly ReferenceRankedStanding[]
): RankChangeDiff[] {
  const scheduledMap = new Map(
    scheduledStandings.map((row) => [row.attemptId, row])
  );
  const diffs: RankChangeDiff[] = [];
  for (const persisted of persistedStandings) {
    const scheduled = scheduledMap.get(persisted.attemptId);
    if (!scheduled) continue;
    if (
      persisted.rank !== scheduled.rank ||
      persisted.elapsedMs !== scheduled.elapsedMs
    ) {
      diffs.push({
        attemptId: persisted.attemptId,
        customerId: persisted.customerId,
        persistedCloseRank: persisted.rank,
        scheduledEndRank: scheduled.rank,
        persistedCloseElapsedMs: persisted.elapsedMs,
        scheduledEndElapsedMs: scheduled.elapsedMs,
      });
    }
  }
  return diffs;
}
