export type QuizEventStatus =
  | 'open'
  | 'scheduled'
  | 'closed'
  | 'active'
  | 'finalizing'
  | 'completed'
  | 'cancelled';

export interface QuizEvent {
  contractVersion?: 1 | 2;
  id: string;
  title: string;
  prizeName: string;
  startsAt: string | null;
  endsAt: string | null;
  status: QuizEventStatus;
  questionCount: number;
  liveWindowSeconds?: number | null;
  maxAttempts?: number;
  maximumPlaySeconds?: number;
  mode?: 'test' | 'live';
  prizeProduct?: QuizPrizeProduct;
  resultsPublishedAt?: string | null;
  rulesVersion?: string | null;
  serverNow?: string;
  timePerQuestionSeconds?: number;
  timeZone?: string;
}

export interface QuizPrizeProduct {
  condition: QuizPrizeCondition | null;
  id: string;
  imageUrl: string | null;
  name: string;
  variantId: string | null;
}

export interface QuizOption {
  id: string;
  label: string;
}

export interface QuizQuestion {
  deadlineAt: string;
  id: string;
  prompt: string;
  options: QuizOption[];
  timeLimitSeconds: number;
  index: number;
  total: number;
  issuedAt?: string;
}

export interface QuizAttempt {
  attemptId: string;
  eventId: string;
  examPassPointsSpent: number;
  remainingLoyaltyPoints: number;
  question: QuizQuestion;
}

export type QuizV2AttemptStatus =
  | 'in_progress'
  | 'submitted_pending_results'
  | 'completed'
  | 'event_cancelled';

export interface QuizV2Attempt {
  attemptId: string;
  eventEndsAt: string;
  eventId: string;
  question?: QuizQuestion;
  resultsAvailableAt: string | null;
  resumed?: boolean;
  serverNow: string;
  status: QuizV2AttemptStatus;
  submittedAt?: string | null;
}

export type QuizActiveAttemptAvailability =
  | 'none'
  | 'active'
  | 'pending_results'
  | 'cancelled'
  | 'unavailable';

export interface QuizActiveAttemptResponse {
  attemptId?: string;
  attempt?: QuizV2Attempt;
  availability: QuizActiveAttemptAvailability;
  eventEndsAt: string | null;
  serverNow: string;
  submittedAt?: string | null;
}

export type QuizPrizeCondition = 'new' | 'used' | 'open_box' | 'refurbished';

/**
 * Signed prize entitlement returned on a winning submission. Mirrors the web
 * `prizeClaim` contract; the mobile client redeems it by adding the prize
 * product to the cart with `voucherToken`/`awardId` attached (verified
 * server-side at order time).
 */
export interface QuizPrizeClaim {
  awardId: string;
  productId: string;
  variantId: string | null;
  condition: QuizPrizeCondition | null;
  voucherToken: string;
  cartPath: string;
}

export interface QuizResult {
  attemptId: string;
  status: 'completed' | 'in_progress';
  correctAnswers: number;
  totalQuestions: number;
  prizeEligible: boolean;
  prizeClaim?: QuizPrizeClaim;
  question?: QuizQuestion;
}

export interface QuizServiceOptions {
  baseUrl?: string;
}

export type QuizIntegrityTier = 'basic' | 'device' | 'strong';

export interface StartQuizAttemptInput extends QuizServiceOptions {
  /**
   * SHA-256 of the native install id. Lets the server share one attempt budget
   * across every account started from this device (anti multi-accounting).
   * Optional: a device that cannot produce one still plays.
   */
  deviceFingerprint?: string | null;
  eventId: string;
  /**
   * The signed-in shopper the caller intends to start for. The request is
   * refused if the resolved auth session belongs to a different user (an
   * account switch mid-request), so a stale start can't spend another
   * shopper's attempt.
   */
  expectedUserId?: string;
  integrityTier: QuizIntegrityTier;
}

export interface StartQuizAttemptV2Input extends QuizServiceOptions {
  acceptedRulesVersion: string;
  deviceFingerprint?: string | null;
  eventId: string;
  expectedUserId: string;
  integrityTier: QuizIntegrityTier;
  mode: 'test' | 'live';
  startRequestId: string;
  termsAccepted: true;
}

export interface SubmitQuizAnswerInput extends QuizServiceOptions {
  attemptId: string;
  questionId: string;
  answer: string;
  integrityTier: QuizIntegrityTier;
  /**
   * ISO-8601 timestamp (with offset) captured when the player answered. The
   * server accepts it as an optional informational field for timing parity.
   */
  clientAnsweredAt?: string;
}

export interface SubmitQuizAnswerV2Input extends QuizServiceOptions {
  answer: string;
  attemptId: string;
  clientAnsweredAt?: string;
  expectedUserId: string;
  questionId: string;
}

export type QuizV2Result =
  | {
      attemptId: string;
      availability: 'pending';
      availableAt: string | null;
    }
  | {
      attemptId: string;
      availability: 'final';
      availableAt: string;
      claim?: { expiresAt: string; token: string };
      prizeClaim?: QuizPrizeClaim;
      rank: number;
      score: number;
      totalQuestions: number;
    }
  | {
      attemptId: string;
      availability: 'unavailable';
      reason?: 'event_cancelled' | 'not_found' | 'tester_revoked';
    };

export interface QuizLeaderboardEntry {
  displayName: string;
  isCurrentCustomer: boolean;
  rank: number;
  score: number;
  status: string;
  submittedAt: string | null;
  totalTimeSeconds: number | null;
}

export interface QuizLeaderboard {
  currentPlayer: QuizLeaderboardEntry | null;
  entries: QuizLeaderboardEntry[];
  participantCount: number | null;
  status: 'published' | 'live' | 'live_hidden' | 'unavailable';
}

type ErrorConstructorWithStackTrace = typeof Error & {
  captureStackTrace?: (
    targetObject: object,
    constructorOpt?: typeof QuizServiceError
  ) => void;
};

export class QuizServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'QuizServiceError';
    Object.setPrototypeOf(this, QuizServiceError.prototype);
    this.code = code;
    this.status = status;

    const captureStackTrace = (Error as ErrorConstructorWithStackTrace)
      .captureStackTrace;
    captureStackTrace?.(this, QuizServiceError);
  }
}
