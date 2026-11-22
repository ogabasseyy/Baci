import { describe, expect, it } from 'vitest';
import { merchantQuizActivationV2RequestSchema } from './quiz-schema-launch';

describe('merchantQuizActivationV2RequestSchema', () => {
  it('accepts a reviewed test launch and rejects an inverted schedule', () => {
    const input = {
      answerKeyReview: { questions: [{ correctOptionId: 'a', position: 1 }] },
      confirmActivation: true,
      eventId: '11111111-1111-4111-8111-111111111111',
      maxAttempts: 10,
      mode: 'test',
      rulesVersion: 'test-v1',
      timePerQuestionSeconds: 10,
      timeZone: 'Africa/Lagos',
      timing: { kind: 'immediate', liveWindowSeconds: 300 },
      variantsPerQuestion: 1,
    };
    expect(merchantQuizActivationV2RequestSchema.safeParse(input).success).toBe(
      true
    );
    expect(
      merchantQuizActivationV2RequestSchema.safeParse({
        ...input,
        timing: {
          endsAt: '2026-08-05T09:00:00.000Z',
          kind: 'scheduled',
          startsAt: '2026-08-05T09:05:00.000Z',
        },
      }).success
    ).toBe(false);
  });

  it('requires regulatory evidence for live mode and rejects it in test mode', () => {
    const input = {
      answerKeyReview: { questions: [{ correctOptionId: 'a', position: 1 }] },
      confirmActivation: true,
      eventId: '11111111-1111-4111-8111-111111111111',
      maxAttempts: 1,
      mode: 'live',
      rulesVersion: 'live-v1',
      timePerQuestionSeconds: 10,
      timeZone: 'Africa/Lagos',
      timing: { kind: 'immediate', liveWindowSeconds: 60 },
      variantsPerQuestion: 3,
    };
    expect(merchantQuizActivationV2RequestSchema.safeParse(input).success).toBe(
      false
    );
    const withEvidence = {
      ...input,
      regulatoryCompliance: {
        basis: 'free_skill_competition',
        evidenceReference: 'Free-entry rules and counsel note 2026-08',
        jurisdiction: 'NG-LA',
      },
    };
    expect(
      merchantQuizActivationV2RequestSchema.safeParse(withEvidence).success
    ).toBe(true);
    expect(
      merchantQuizActivationV2RequestSchema.safeParse({
        ...withEvidence,
        maxAttempts: 10,
        mode: 'test',
        rulesVersion: 'test-v1',
        variantsPerQuestion: 1,
      }).success
    ).toBe(false);
  });

  it('rejects edgeRoomCount unless backendMode is edge_rooms', () => {
    const base = {
      answerKeyReview: { questions: [{ correctOptionId: 'a', position: 1 }] },
      confirmActivation: true,
      eventId: '11111111-1111-4111-8111-111111111111',
      maxAttempts: 10,
      mode: 'test',
      rulesVersion: 'test-v1',
      timePerQuestionSeconds: 10,
      timeZone: 'Africa/Lagos',
      timing: { kind: 'immediate', liveWindowSeconds: 300 },
      variantsPerQuestion: 1,
    };

    expect(
      merchantQuizActivationV2RequestSchema.safeParse({
        ...base,
        edgeRoomCount: 8,
      }).success
    ).toBe(false);

    expect(
      merchantQuizActivationV2RequestSchema.safeParse({
        ...base,
        backendMode: 'postgres',
        edgeRoomCount: 8,
      }).success
    ).toBe(false);

    expect(
      merchantQuizActivationV2RequestSchema.safeParse({
        ...base,
        backendMode: 'edge_rooms',
        edgeRoomCount: 8,
      }).success
    ).toBe(true);
  });
});
