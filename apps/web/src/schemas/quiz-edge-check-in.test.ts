import { describe, expect, it } from 'vitest';
import {
  quizEdgeAdmissionRpcResultSchema,
  quizEdgeCheckInParamsSchema,
  quizEdgeCheckInRequestSchema,
} from './quiz-edge-check-in';

describe('quiz-edge-check-in schemas', () => {
  it('validates eventId params and check-in request body', () => {
    expect(
      quizEdgeCheckInParamsSchema.safeParse({
        eventId: '11111111-1111-4111-8111-111111111111',
      }).success
    ).toBe(true);
    expect(
      quizEdgeCheckInParamsSchema.safeParse({ eventId: 'bad-id' }).success
    ).toBe(false);
    expect(
      quizEdgeCheckInRequestSchema.safeParse({
        acceptedRulesVersion: 'live-v1',
        termsAccepted: true,
        checkInRequestId: '11111111-1111-4111-8111-111111111111',
        appVersion: '2.10.0',
        platform: 'android',
      }).success
    ).toBe(true);
    expect(quizEdgeCheckInRequestSchema.safeParse({}).success).toBe(false);
  });

  it('parses valid admission RPC results and rejects malformed rows', () => {
    const parsed = quizEdgeAdmissionRpcResultSchema.safeParse({
      admissionId: '11111111-1111-4111-8111-111111111111',
      eventId: '22222222-2222-4222-8222-222222222222',
      merchantId: '33333333-3333-4333-8333-333333333333',
      customerId: '44444444-4444-4444-8444-444444444444',
      userId: '55555555-5555-4555-8555-555555555555',
      roomId: 'room-0001',
      roomIndex: 1,
      leaderboardUsername: 'Ada',
      maxAttempts: 1,
      startsAt: '2026-11-27T18:00:00.000Z',
      endsAt: '2026-11-27T18:10:00.000Z',
      rulesVersion: 'live-v1',
      mode: 'live',
      reused: false,
    });
    expect(parsed.success).toBe(true);
    expect(
      quizEdgeAdmissionRpcResultSchema.safeParse({ admissionId: 'bad' }).success
    ).toBe(false);
  });
});
