import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  legacyQuizEventDefaults,
  mockFetch,
  quizService,
  resetQuizServiceMocks,
  restoreQuizServiceGlobals,
} from './quiz.test-support';

const { fetchQuizEvents } = quizService;

// Paging and server-clock receipt coverage for fetchQuizEvents; the rest of
// the event service lives in quiz.test.ts.
describe('quiz event list paging and receipt clock', () => {
  afterAll(restoreQuizServiceGlobals);
  beforeEach(resetQuizServiceMocks);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches all quiz event pages before returning the mobile list', async () => {
    let deviceNowMs = Date.parse('2026-05-20T09:00:00.000Z');
    jest.spyOn(Date, 'now').mockImplementation(() => deviceNowMs);
    // Each page arrives at a different device time; each keeps its own receipt.
    mockFetch
      .mockImplementationOnce(async () => {
        deviceNowMs += 1_000;
        return new Response(
          JSON.stringify({
            entryMode: 'free-v1',
            events: [
              {
                endsAt: '2026-05-20T10:10:00.000Z',
                id: 'event-1',
                prizeName: 'N50,000 airtime',
                questionCount: 5,
                startsAt: '2026-05-20T10:00:00.000Z',
                status: 'open',
                title: 'Win airtime',
              },
            ],
            pagination: {
              hasMore: true,
              limit: 50,
              nextOffset: 50,
              offset: 0,
            },
          }),
          { status: 200 }
        );
      })
      .mockImplementationOnce(async () => {
        deviceNowMs += 4_000;
        return new Response(
          JSON.stringify({
            entryMode: 'free-v1',
            events: [
              {
                endsAt: '2026-05-21T10:10:00.000Z',
                id: 'event-2',
                prizeName: 'N10,000 data',
                questionCount: 3,
                startsAt: '2026-05-21T10:00:00.000Z',
                status: 'scheduled',
                title: 'Win data',
              },
            ],
            pagination: {
              hasMore: false,
              limit: 50,
              nextOffset: null,
              offset: 50,
            },
          }),
          { status: 200 }
        );
      });

    await expect(
      fetchQuizEvents({ baseUrl: 'https://example.com' })
    ).resolves.toEqual([
      expect.objectContaining({
        ...legacyQuizEventDefaults,
        id: 'event-1',
        liveWindowSeconds: 600,
        maximumPlaySeconds: 150,
        serverNowReceivedAtMs: Date.parse('2026-05-20T09:00:01.000Z'),
      }),
      expect.objectContaining({
        ...legacyQuizEventDefaults,
        id: 'event-2',
        liveWindowSeconds: 600,
        maximumPlaySeconds: 90,
        serverNowReceivedAtMs: Date.parse('2026-05-20T09:00:05.000Z'),
      }),
    ]);
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://example.com/api/quiz/events?merchantId=merchant-1&limit=50&offset=50',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('requests contract 2 and preserves v2 prize and timing fields', async () => {
    const event = {
      contractVersion: 2,
      endsAt: '2026-08-04T12:05:00.000Z',
      id: 'event-1',
      liveWindowSeconds: 300,
      maxAttempts: 10,
      maximumPlaySeconds: 200,
      mode: 'test',
      prizeName: 'iPhone XR',
      prizeProduct: {
        condition: 'used',
        id: '11111111-1111-4111-8111-111111111111',
        imageUrl: 'https://cdn.example.com/iphone.png',
        name: 'iPhone XR',
        variantId: null,
      },
      questionCount: 20,
      resultsPublishedAt: null,
      rulesVersion: 'test-v1',
      startsAt: '2026-08-04T12:00:00.000Z',
      status: 'active',
      timePerQuestionSeconds: 10,
      timeZone: 'Africa/Lagos',
      title: 'Redmi Warriors',
    };
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse('2026-08-04T12:00:03.000Z'));
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          contractVersion: 2,
          entryMode: 'free-v1',
          events: [event],
          serverNow: '2026-08-04T12:00:00.000Z',
        }),
        { status: 200 }
      )
    );

    await expect(fetchQuizEvents()).resolves.toEqual([
      {
        ...event,
        serverNow: '2026-08-04T12:00:00.000Z',
        serverNowReceivedAtMs: Date.parse('2026-08-04T12:00:03.000Z'),
      },
    ]);
    expect(
      new Headers(mockFetch.mock.calls[0]?.[1]?.headers).get(
        'X-Baci-Quiz-Contract'
      )
    ).toBe('2');
  });
});
