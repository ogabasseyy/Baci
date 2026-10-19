import { describe, expect, it } from 'vitest';
import {
  quizV2ActiveAttemptResponseSchema,
  quizV2AttemptResponseSchema,
  quizV2EventSchema,
  quizV2EventsResponseSchema,
  quizV2ResultResponseSchema,
  startQuizAttemptV2RequestSchema,
} from './quiz-contract';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = 'attempt-1';
const TIME = '2026-08-04T12:00:00.000Z';
const ENTRY_MODE = 'free-v1' as const;

const event = {
  contractVersion: 2,
  endsAt: '2026-08-04T12:05:00.000Z',
  id: 'event-1',
  liveWindowSeconds: 300,
  maxAttempts: 10,
  maximumPlaySeconds: 200,
  mode: 'test' as const,
  prizeName: 'MacBook USB',
  prizeProduct: {
    condition: 'used' as const,
    id: EVENT_ID,
    imageUrl: 'https://cdn.example.com/prize.png',
    name: 'MacBook USB',
    variantId: null,
  },
  questionCount: 20,
  resultsPublishedAt: null,
  rulesVersion: 'test-v1',
  startsAt: TIME,
  status: 'active' as const,
  timePerQuestionSeconds: 10,
  timeZone: 'Africa/Lagos',
  title: 'Daily devices quiz',
};

describe('quiz v2 wire contracts', () => {
  it('requires mode, timing, rules, and full prize identity on v2 events', () => {
    expect(quizV2EventSchema.parse(event)).toEqual(event);
    expect(
      quizV2EventSchema.safeParse({
        ...event,
        contractVersion: 1,
      }).success
    ).toBe(false);
    expect(
      quizV2EventSchema.safeParse({ ...event, rulesVersion: '' }).success
    ).toBe(false);
    expect(
      quizV2EventSchema.safeParse({
        ...event,
        prizeProduct: { ...event.prizeProduct, permitReference: 'private' },
      }).success
    ).toBe(false);
    expect(
      quizV2EventsResponseSchema.safeParse({
        contractVersion: 2,
        entryMode: ENTRY_MODE,
        events: [event],
        serverNow: TIME,
        complianceVerified: true,
      }).success
    ).toBe(false);
  });

  it('keeps unpublished answer states free of score, rank, and claim fields', () => {
    const pending = quizV2ResultResponseSchema.parse({
      attemptId: ATTEMPT_ID,
      availability: 'pending',
      availableAt: null,
    });

    expect(pending).not.toHaveProperty('score');
    expect(
      quizV2ResultResponseSchema.safeParse({
        attemptId: ATTEMPT_ID,
        availability: 'final',
        availableAt: TIME,
        score: 10,
        totalQuestions: 20,
      }).success
    ).toBe(false);
    expect(
      quizV2ResultResponseSchema.safeParse({
        attemptId: ATTEMPT_ID,
        availability: 'pending',
        availableAt: null,
        score: 10,
      }).success
    ).toBe(false);
  });

  it('accepts the signed product prize claim on a final result', () => {
    expect(
      quizV2ResultResponseSchema.parse({
        attemptId: ATTEMPT_ID,
        availability: 'final',
        availableAt: TIME,
        prizeClaim: {
          awardId: EVENT_ID,
          cartPath:
            '/ogabassey/cart?item_id=33333333-3333-4333-8333-333333333333',
          condition: 'used',
          productId: '33333333-3333-4333-8333-333333333333',
          variantId: null,
          voucherToken: 'signed-voucher',
        },
        rank: 1,
        score: 20,
        totalQuestions: 20,
      })
    ).toMatchObject({ availability: 'final', rank: 1 });
  });

  it('models event cancellation as a terminal answer state without a result', () => {
    expect(
      quizV2AttemptResponseSchema.safeParse({
        attemptId: ATTEMPT_ID,
        eventEndsAt: '2026-08-04T12:05:00.000Z',
        eventId: 'event-1',
        resultsAvailableAt: null,
        serverNow: TIME,
        status: 'event_cancelled',
      }).success
    ).toBe(true);
    expect(
      quizV2AttemptResponseSchema.safeParse({
        attemptId: ATTEMPT_ID,
        eventEndsAt: '2026-08-04T12:05:00.000Z',
        eventId: 'event-1',
        resultsAvailableAt: null,
        score: 10,
        serverNow: TIME,
        status: 'event_cancelled',
      }).success
    ).toBe(false);
  });

  it('requires a strict resumable active-attempt projection', () => {
    const active = {
      attempt: {
        attemptId: ATTEMPT_ID,
        eventEndsAt: '2026-08-04T12:05:00.000Z',
        eventId: 'event-1',
        question: {
          deadlineAt: '2026-08-04T12:00:10.000Z',
          id: 'question-1',
          index: 1,
          issuedAt: TIME,
          options: [{ id: 'a', label: 'A' }],
          prompt: 'Pick one',
          timeLimitSeconds: 10,
          total: 20,
        },
        resultsAvailableAt: null,
        serverNow: TIME,
        status: 'in_progress' as const,
      },
      availability: 'active' as const,
      eventEndsAt: '2026-08-04T12:05:00.000Z',
      serverNow: TIME,
    };

    expect(quizV2ActiveAttemptResponseSchema.parse(active)).toEqual(active);
    expect(
      quizV2ActiveAttemptResponseSchema.safeParse({ ...active, score: 10 })
        .success
    ).toBe(false);
    expect(
      quizV2ActiveAttemptResponseSchema.safeParse({
        ...active,
        attempt: undefined,
      }).success
    ).toBe(false);
    expect(
      quizV2ActiveAttemptResponseSchema.parse({
        attemptId: ATTEMPT_ID,
        availability: 'cancelled',
        eventEndsAt: '2026-08-04T12:05:00.000Z',
        serverNow: TIME,
      })
    ).not.toHaveProperty('attempt');
    expect(
      quizV2ResultResponseSchema.safeParse({
        attemptId: ATTEMPT_ID,
        availability: 'unavailable',
        reason: 'event_cancelled',
        rank: 1,
      }).success
    ).toBe(false);
    expect(
      quizV2ResultResponseSchema.safeParse({
        attemptId: ATTEMPT_ID,
        availability: 'unavailable',
        reason: 'not_owner',
      }).success
    ).toBe(false);
  });

  it('requires deliberate v2 start acceptance and rejects unknown fields', () => {
    const request = {
      acceptedRulesVersion: 'test-v1',
      appVersion: '1.0.0',
      entryMode: 'free-v1' as const,
      eventId: EVENT_ID,
      integrityTier: 'device' as const,
      platform: 'android' as const,
      startRequestId: '22222222-2222-4222-8222-222222222222',
      termsAccepted: true as const,
    };

    expect(startQuizAttemptV2RequestSchema.parse(request)).toEqual(request);
    expect(
      startQuizAttemptV2RequestSchema.safeParse({
        ...request,
        termsAccepted: false,
      }).success
    ).toBe(false);
    expect(
      startQuizAttemptV2RequestSchema.safeParse({ ...request, extra: true })
        .success
    ).toBe(false);
  });

  it('rejects a live event that weakens the fixed one-attempt policy', () => {
    expect(
      quizV2EventSchema.safeParse({
        ...event,
        maxAttempts: 2,
        mode: 'live',
      }).success
    ).toBe(false);
    expect(
      quizV2EventSchema.safeParse({
        ...event,
        maximumPlaySeconds: 201,
      }).success
    ).toBe(false);
  });

  it('requires timestamps and the declared event window to agree', () => {
    expect(
      quizV2EventSchema.safeParse({
        ...event,
        endsAt: event.startsAt,
        liveWindowSeconds: 1,
      }).success
    ).toBe(false);
    expect(
      quizV2EventSchema.safeParse({
        ...event,
        liveWindowSeconds: 299,
      }).success
    ).toBe(false);
  });

  it('rejects live windows that cannot support the configured play time', () => {
    expect(
      quizV2EventSchema.safeParse({
        ...event,
        endsAt: '2026-08-04T12:00:01.000Z',
        liveWindowSeconds: 1,
        maxAttempts: 1,
        mode: 'live',
      }).success
    ).toBe(false);
  });

  it('requires the free-entry marker on the authoritative v2 list response', () => {
    expect(
      quizV2EventsResponseSchema.safeParse({
        contractVersion: 2,
        events: [event],
        serverNow: TIME,
      }).success
    ).toBe(false);
    expect(
      quizV2EventsResponseSchema.safeParse({
        contractVersion: 2,
        entryMode: ENTRY_MODE,
        events: [event],
        pagination: {
          hasMore: false,
          limit: 50,
          nextOffset: null,
          offset: 0,
        },
        serverNow: TIME,
      }).success
    ).toBe(true);
  });
});
