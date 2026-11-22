import {
  checkInQuizEdgeEvent,
  clearQuizEdgeSession,
  getQuizEdgeSession,
  QUIZ_TICKET_HEADER,
  startQuizEdgeAttempt,
  submitQuizEdgeAnswer,
} from './quiz-edge-transport';

const mockRequestQuizV2 = jest.fn();
const mockGetQuizAttestationHeaders = jest.fn();

jest.mock('./quiz-request', () => ({
  QUIZ_CONTRACT_HEADER: 'X-Baci-Quiz-Contract',
  QUIZ_CONTRACT_VERSION: '2',
  QUIZ_REQUEST_TIMEOUT_MS: 15_000,
  getQuizAppMetadata: () => ({ appVersion: '2.11.0', platform: 'android' }),
  requestQuizV2: (...args: unknown[]) => mockRequestQuizV2(...args),
}));

jest.mock('./quiz-app-attestation', () => ({
  getQuizAttestationHeaders: (...args: unknown[]) =>
    mockGetQuizAttestationHeaders(...args),
}));

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const MERCHANT_ID = '33333333-3333-4333-8333-333333333333';
const ADMISSION_ID = '44444444-4444-4444-8444-444444444444';
const ATTEMPT_ID = '55555555-5555-4555-8555-555555555555';
const QUESTION_ID = '66666666-6666-4666-8666-666666666666';

const MOCK_CHECK_IN = {
  admissionId: ADMISSION_ID,
  eventId: EVENT_ID,
  merchantId: MERCHANT_ID,
  roomId: `quiz-room:${EVENT_ID}:0`,
  roomIndex: 0,
  leaderboardUsername: 'LagosRunner',
  maxAttempts: 1,
  startsAt: '2026-12-01T18:00:00.000Z',
  endsAt: '2026-12-01T18:10:00.000Z',
  rulesVersion: 'live-v1',
  reused: false,
  backendMode: 'edge_rooms' as const,
  edgeBaseUrl: 'https://quiz-edge.ogabassey.com/',
  ticket: 'bqt1.eyJ0ZXN0IjoxfQ.sig123',
};

const MOCK_ATTEMPT_RESPONSE = {
  attemptId: ATTEMPT_ID,
  eventId: EVENT_ID,
  status: 'in_progress' as const,
  serverNow: '2026-12-01T18:00:05.000Z',
  eventEndsAt: '2026-12-01T18:10:00.000Z',
  resultsAvailableAt: '2026-12-01T18:10:00.000Z',
  question: {
    id: QUESTION_ID,
    index: 1,
    total: 10,
    prompt: 'Capital of Lagos State?',
    options: [
      { id: 'opt-a', label: 'Ikeja' },
      { id: 'opt-b', label: 'Abuja' },
    ],
    deadlineAt: '2026-12-01T18:00:15.000Z',
    issuedAt: '2026-12-01T18:00:05.000Z',
    timeLimitSeconds: 10,
  },
};

describe('quiz-edge-transport', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    clearQuizEdgeSession(EVENT_ID, USER_ID);
    mockGetQuizAttestationHeaders.mockResolvedValue({
      'X-Firebase-AppCheck': 'attest-token',
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('checks in on origin, caches normalized edge session, and starts attempt on edge worker with X-Baci-Quiz-Ticket', async () => {
    mockRequestQuizV2.mockResolvedValue(MOCK_CHECK_IN);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => MOCK_ATTEMPT_RESPONSE,
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const session = await checkInQuizEdgeEvent({
      acceptedRulesVersion: 'live-v1',
      checkInRequestId: '77777777-7777-4777-8777-777777777777',
      deviceFingerprint: 'a'.repeat(64),
      eventId: EVENT_ID,
      expectedUserId: USER_ID,
      integrityTier: 'device',
      mode: 'live',
      startRequestId: '88888888-8888-4888-8888-888888888888',
      termsAccepted: true,
    });

    expect(session.edgeBaseUrl).toBe('https://quiz-edge.ogabassey.com');
    expect(getQuizEdgeSession(EVENT_ID, USER_ID)?.ticket).toBe(
      MOCK_CHECK_IN.ticket
    );

    const started = await startQuizEdgeAttempt(session, {
      acceptedRulesVersion: 'live-v1',
      eventId: EVENT_ID,
      integrityTier: 'device',
      startRequestId: '88888888-8888-4888-8888-888888888888',
      termsAccepted: true,
    });

    expect(started.attemptId).toBe(ATTEMPT_ID);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://quiz-edge.ogabassey.com/api/quiz/events/${EVENT_ID}/start`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          [QUIZ_TICKET_HEADER]: MOCK_CHECK_IN.ticket,
        }),
      })
    );
  });

  it('retries submitQuizEdgeAnswer once on transient network drop and succeeds idempotently', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ...MOCK_ATTEMPT_RESPONSE,
          status: 'submitted_pending_results',
          submittedAt: '2026-12-01T18:01:00.000Z',
          question: undefined,
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await submitQuizEdgeAnswer(
      { ...MOCK_CHECK_IN, edgeBaseUrl: 'https://quiz-edge.ogabassey.com' },
      {
        attemptId: ATTEMPT_ID,
        questionId: QUESTION_ID,
        answer: 'opt-a',
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe('submitted_pending_results');
  });
});
