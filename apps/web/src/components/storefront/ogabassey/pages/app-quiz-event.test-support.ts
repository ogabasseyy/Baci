import type { QuizV2Event } from '@baci/shared/schemas';

/** A schema-valid contract-v2 live event for app-only quiz tests. */
export function appQuizEvent(overrides: Partial<QuizV2Event> = {}): QuizV2Event {
  return {
    contractVersion: 2,
    endsAt: '2026-08-05T10:05:00.000Z',
    id: '22222222-2222-4222-8222-222222222222',
    liveWindowSeconds: 300,
    maxAttempts: 1,
    maximumPlaySeconds: 200,
    mode: 'live',
    prizeName: 'iPhone XR',
    prizeProduct: {
      condition: 'refurbished',
      id: '33333333-3333-4333-8333-333333333333',
      imageUrl: null,
      name: 'iPhone XR',
      variantId: null,
    },
    questionCount: 20,
    resultsPublishedAt: null,
    rulesVersion: 'rules-v1',
    startsAt: '2026-08-05T10:00:00.000Z',
    status: 'active',
    timePerQuestionSeconds: 10,
    timeZone: 'Africa/Lagos',
    title: 'Redmi Warriors',
    ...overrides,
  };
}

export function appQuizEventsResponse(events: QuizV2Event[]) {
  return {
    contractVersion: 2,
    entryMode: 'free-v1',
    events,
    pagination: { hasMore: false, limit: 20, nextOffset: null, offset: 0 },
    serverNow: '2026-08-05T10:00:01.000Z',
  };
}
