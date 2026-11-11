import { describe, expect, it } from 'vitest';
import {
  piggyvestCaptureRequeueReasonSchema,
  piggyvestCaptureRequeueResultSchema,
  piggyvestReviewCaptureSchema,
} from './webhook-capture-operator-replay';

describe('operator replay wire schemas', () => {
  it('accepts each requeue outcome the database returns', () => {
    for (const result of [
      {
        outcome: 'requeued',
        auditId: 1,
        previousAttempts: 20,
        previousLastError: null,
        operatorReplays: 1,
      },
      { outcome: 'not_found' },
      { outcome: 'not_in_review', processingState: 'processed' },
      { outcome: 'replay_limit_reached', operatorReplays: 5 },
    ])
      expect(piggyvestCaptureRequeueResultSchema.parse(result)).toEqual(result);
  });

  it('rejects an unknown outcome or a needs_review "not in review"', () => {
    expect(
      piggyvestCaptureRequeueResultSchema.safeParse({ outcome: 'done' }).success
    ).toBe(false);
    expect(
      piggyvestCaptureRequeueResultSchema.safeParse({
        outcome: 'not_in_review',
        processingState: 'needs_review',
      }).success
    ).toBe(false);
  });

  it('bounds the reason at 10 to 500 characters after trimming', () => {
    expect(
      piggyvestCaptureRequeueReasonSchema.safeParse('   short   ').success
    ).toBe(false);
    expect(piggyvestCaptureRequeueReasonSchema.parse('  ten chars!  ')).toBe(
      'ten chars!'
    );
    expect(
      piggyvestCaptureRequeueReasonSchema.safeParse('x'.repeat(501)).success
    ).toBe(false);
  });

  it('requires a UUID capture id in review metadata', () => {
    expect(
      piggyvestReviewCaptureSchema.safeParse({
        captureId: 'not-a-uuid',
        eventType: null,
        providerTransactionId: null,
        keyVersion: 'k',
        attempts: 0,
        lastError: null,
        receivedAt: 'x',
        parkedAt: 'x',
        operatorReplays: 0,
      }).success
    ).toBe(false);
  });
});
