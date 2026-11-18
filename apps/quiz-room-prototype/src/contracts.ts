export type QuizMode = 'test' | 'live';

export type QuizPlatform = 'android' | 'ios' | 'web';

export type QuizIntegrityTier = 'basic' | 'device' | 'strong';

export type QuizEventStatus =
  | 'scheduled'
  | 'active'
  | 'finalizing'
  | 'completed'
  | 'cancelled';

export type QuizAttemptStatus =
  | 'started'
  | 'submitted'
  | 'scored'
  | 'disqualified'
  | 'expired'
  | 'test_reset'
  | 'tester_revoked'
  | 'event_cancelled';

export type QuizWireAttemptStatus =
  | 'in_progress'
  | 'submitted_pending_results'
  | 'completed'
  | 'event_cancelled';

export type QuizAttemptCloseReason =
  | 'completed'
  | 'event_closed'
  | 'event_cancelled'
  | 'tester_revoked'
  | 'disqualified';

export type QuizRoomSealMode =
  | 'persisted_close'
  | 'scheduled_ends_at'
  | 'cancelled';

export interface QuizAdmissionTicket {
  userId: string;
  customerId: string;
  merchantId: string;
  eventId: string;
  roomId: string;
  deviceHash: string;
  leaderboardUsername: string;
  expiresAtMs: number;
  admissionId?: string;
  mode?: QuizMode;
  issuedAtMs?: number;
}

export interface QuizVerifiedBearerUser {
  userId: string;
  expiresAtMs: number;
  issuedAtMs?: number;
  email?: string;
  role?: string;
  merchantId?: string;
  customerId?: string;
}

export interface QuizQuestionOption {
  id: string;
  label: string;
}

export interface QuizQuestionVariant {
  id: string;
  slotId: string;
  prompt: string;
  options: readonly QuizQuestionOption[];
  /** Private SHA-256 hex digest of normalized answer key. Never returned on play wire responses. */
  answerKeyHash: string;
  active: boolean;
}

export interface QuizQuestionSlot {
  id: string;
  slotIndex: number;
  active: boolean;
  variants: readonly QuizQuestionVariant[];
}

export interface QuizEventConfig {
  eventId: string;
  merchantId: string;
  mode: QuizMode;
  contractVersion: 2;
  rulesVersion: string;
  questionCount: number;
  timePerQuestionSeconds: number;
  maxAttempts: number;
  startsAtMs: number;
  endsAtMs: number;
  status: QuizEventStatus;
  slots: readonly QuizQuestionSlot[];
  /** Optional retention period after seal before deleteAll() is permitted. */
  retentionPeriodMs?: number;
  /** Optional room alarm cadence for scoreboard ticks. */
  scoreboardTickMs?: number;
  /** Optional room alarm cadence for batch queue flushes. */
  flushTickMs?: number;
}

export interface QuizWireQuestion {
  id: string;
  prompt: string;
  options: readonly QuizQuestionOption[];
  timeLimitSeconds: number;
  index: number;
  total: number;
  issuedAt: string;
  deadlineAt: string;
}

export interface QuizWireAttemptResponse {
  attemptId: string;
  eventId: string;
  status: QuizWireAttemptStatus;
  serverNow: string;
  eventEndsAt: string;
  resultsAvailableAt: string | null;
  resumed?: boolean;
  submittedAt?: string | null;
  question?: QuizWireQuestion;
}

export interface QuizWireActiveAttemptResponse {
  availability:
    | 'none'
    | 'active'
    | 'pending_results'
    | 'cancelled'
    | 'unavailable';
  attemptId?: string;
  serverNow: string;
  eventEndsAt: string | null;
  submittedAt?: string | null;
  attempt?: QuizWireAttemptResponse;
}

export interface QuizAttemptAnswerTranscript {
  questionId: string;
  slotId: string;
  position: number;
  variantId: string;
  optionOrder: readonly string[];
  issuedAtMs: number;
  receivedAtMs: number;
  rawAnswer: string | null;
  selectedAnswerHash: string | null;
  answeredInMs: number;
  timeout: boolean;
  scoreDelta: number;
}

export interface QuizAttemptBundle {
  attemptId: string;
  admissionId: string;
  eventId: string;
  merchantId: string;
  roomId: string;
  userId: string;
  customerId: string;
  deviceHash: string;
  leaderboardUsername: string;
  attemptNumber: number;
  rulesVersion: string;
  integrityTier: QuizIntegrityTier;
  appVersion: string;
  platform: QuizPlatform;
  startRequestId: string;
  startedAtMs: number;
  submittedAtMs: number;
  closeReason: QuizAttemptCloseReason;
  score: number;
  answers: readonly QuizAttemptAnswerTranscript[];
  partIndex: number;
  totalParts: number;
  bundleChecksumSha256: string;
}

export interface QuizRoomSealManifest {
  eventId: string;
  roomId: string;
  persistedCloseAtMs: number;
  eventStatus: 'completed' | 'cancelled';
  sealMode: QuizRoomSealMode;
  attemptCount: number;
  answerCount: number;
  batchIds: readonly string[];
  batchCount: number;
  roomChecksumSha256: string;
}

export interface BillingCounters {
  workerInvocations: number;
  workerCpuMs: number;
  roomRequests: number;
  rowsWritten: number;
  rowsRead: number;
  bytesPacked: number;
  queueMessages: number;
  queueOperations: number;
}

export function createEmptyBillingCounters(): BillingCounters {
  return {
    workerInvocations: 0,
    workerCpuMs: 0,
    roomRequests: 0,
    rowsWritten: 0,
    rowsRead: 0,
    bytesPacked: 0,
    queueMessages: 0,
    queueOperations: 0,
  };
}

export interface QuizPackedQueueMessage {
  batchId: string;
  eventId: string;
  roomId: string;
  seq: number;
  createdAtMs: number;
  bundleCount: number;
  bundles: readonly QuizAttemptBundle[];
  payloadSha256: string;
}

export interface QuizControlStateSnapshot {
  version: number;
  updatedAtMs: number;
  cancelledEvents: Readonly<
    Record<string, { cancelledAtMs: number; reason?: string }>
  >;
  blockedAttemptIds: readonly string[];
  blockedCustomerKeys: readonly string[];
  revokedTesterKeys: readonly string[];
  disqualifiedAttemptIds: readonly string[];
  suppressedAttemptIds: readonly string[];
  deletedCustomerIds: readonly string[];
  publishedEvents: Readonly<
    Record<
      string,
      {
        publishedAtMs: number;
        eventStatus: 'completed' | 'cancelled';
        manifestChecksumSha256?: string;
      }
    >
  >;
}

export interface QuizLiveRankSubmission {
  eventId: string;
  merchantId: string;
  attemptId: string;
  customerId: string;
  userId: string;
  leaderboardUsername: string;
  score: number;
  elapsedMs: number;
  submittedAtMs: number;
  attemptStatus: 'submitted' | 'scored';
}

export interface QuizLeaderboardApiEntry {
  displayName: string;
  isCurrentCustomer: boolean;
  rank: number;
  score: number;
  status: string;
  submittedAt: string | null;
  totalTimeSeconds: number | null;
}

export interface QuizLeaderboardApiResponse {
  currentPlayer: QuizLeaderboardApiEntry | null;
  entries: readonly QuizLeaderboardApiEntry[];
  participantCount: number | null;
  status: 'published' | 'live' | 'live_hidden' | 'unavailable';
}

export interface QuizPrizeClaim {
  awardId: string;
  cartPath: string;
  condition: 'new' | 'used' | 'open_box' | 'refurbished' | null;
  productId: string;
  variantId: string | null;
  voucherToken: string;
}

export interface QuizResultClaim {
  expiresAt: string;
  token: string;
}

export type QuizAttemptResultResponse =
  | {
      attemptId: string;
      availability: 'final';
      availableAt: string;
      score: number;
      rank: number;
      totalQuestions: number;
      claim?: QuizResultClaim;
      prizeClaim?: QuizPrizeClaim;
    }
  | {
      attemptId: string;
      availability: 'pending';
      availableAt: string | null;
    }
  | {
      attemptId: string;
      availability: 'unavailable';
      reason?: 'event_cancelled' | 'not_found' | 'tester_revoked';
    };

export interface QuizPrivateResultRecord {
  eventId: string;
  merchantId: string;
  attemptId: string;
  userId: string;
  customerId: string;
  leaderboardUsername: string;
  rank: number;
  score: number;
  totalQuestions: number;
  attemptStatus: 'submitted' | 'scored';
  submittedAtMs: number;
  totalTimeSeconds: number;
  hasAward: boolean;
  retentionExpiresAtMs: number;
}

export interface QuizErrorResponse {
  error: string;
  code: string;
}

export class QuizRoomError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'QuizRoomError';
    this.code = code;
    this.status = status;
  }
}
