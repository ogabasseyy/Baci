import { describe, expect, it } from '@jest/globals';
import {
  quizAttemptSchema,
  quizEventSchema,
  quizEventsResponseSchema,
  quizOptionSchema,
  quizParticipantCountResponseSchema,
  quizQuestionSchema,
  quizResultSchema,
} from './quiz-schemas';
import { validLegacyQuizEvent as validEvent } from './quiz-schemas.test-support';

const validOption = {
  id: 'option-1',
  label: 'Lagos',
};

const validQuestion = {
  deadlineAt: '2026-07-08T12:00:30.000Z',
  id: 'question-1',
  prompt: 'Which city is the capital of Lagos State?',
  options: [validOption],
  timeLimitSeconds: 30,
  index: 1,
  total: 3,
};

const validAttempt = {
  attemptId: 'attempt-1',
  eventId: 'event-1',
  examPassPointsSpent: 1,
  remainingLoyaltyPoints: 4,
  question: validQuestion,
};

const completedResult = {
  attemptId: 'attempt-1',
  status: 'completed',
  correctAnswers: 2,
  totalQuestions: 3,
  prizeEligible: true,
};

type SafeParseResult =
  | { data: unknown; success: true }
  | {
      error: { issues: QuizSchemaIssue[] };
      success: false;
    };

type QuizSchemaIssue = Readonly<{
  errors?: QuizSchemaIssue[][];
  path: PropertyKey[];
}>;

function hasIssueAtPath(
  issues: readonly QuizSchemaIssue[],
  path: Array<string | number>
): boolean {
  return issues.some(
    (issue) =>
      JSON.stringify(issue.path) === JSON.stringify(path) ||
      (issue.errors?.some((nestedIssues) =>
        hasIssueAtPath(nestedIssues, path)
      ) ??
        false)
  );
}

function expectInvalidIssue(
  parseResult: SafeParseResult,
  path: Array<string | number>
) {
  expect(parseResult.success).toBe(false);
  if (!parseResult.success) {
    expect(hasIssueAtPath(parseResult.error.issues, path)).toBe(true);
  }
}

describe('quiz response schemas', () => {
  it('parses valid fixtures for every exported quiz schema', () => {
    const parsedEvent = quizEventSchema.parse(validEvent);
    const parsedEventsResponse = quizEventsResponseSchema.parse({
      entryMode: 'free-v1',
      events: [validEvent],
    });

    expect(quizOptionSchema.parse(validOption)).toEqual(validOption);
    expect(quizQuestionSchema.parse(validQuestion)).toEqual(validQuestion);
    expect(parsedEvent).toMatchObject({
      ...validEvent,
      contractVersion: 1,
      liveWindowSeconds: 600,
      maxAttempts: 1,
      maximumPlaySeconds: 90,
      mode: 'live',
      rulesVersion: null,
    });
    expect(parsedEventsResponse).toMatchObject({
      entryMode: 'free-v1',
      events: [
        {
          ...validEvent,
          contractVersion: 1,
          liveWindowSeconds: 600,
          maximumPlaySeconds: 90,
        },
      ],
    });
    expect(quizAttemptSchema.parse(validAttempt)).toEqual(validAttempt);
    expect(quizResultSchema.parse(completedResult)).toEqual(completedResult);
    expect(
      quizParticipantCountResponseSchema.parse({ participantCount: 2 })
    ).toEqual({
      participantCount: 2,
    });
  });

  it('rejects empty string identity and display fields', () => {
    const invalidFields = [
      [quizOptionSchema.safeParse({ ...validOption, id: '' }), ['id']],
      [quizOptionSchema.safeParse({ ...validOption, label: '' }), ['label']],
      [quizQuestionSchema.safeParse({ ...validQuestion, id: '' }), ['id']],
      [
        quizQuestionSchema.safeParse({ ...validQuestion, prompt: '' }),
        ['prompt'],
      ],
      [quizEventSchema.safeParse({ ...validEvent, id: '' }), ['id']],
      [quizEventSchema.safeParse({ ...validEvent, title: '' }), ['title']],
      [
        quizEventSchema.safeParse({ ...validEvent, prizeName: '' }),
        ['prizeName'],
      ],
      [
        quizAttemptSchema.safeParse({ ...validAttempt, attemptId: '' }),
        ['attemptId'],
      ],
      [
        quizAttemptSchema.safeParse({ ...validAttempt, eventId: '' }),
        ['eventId'],
      ],
      [
        quizResultSchema.safeParse({ ...completedResult, attemptId: '' }),
        ['attemptId'],
      ],
    ] as const;

    for (const [result, path] of invalidFields) {
      expectInvalidIssue(result, [...path]);
    }
  });

  it('rejects event lists from a backend without free-entry support', () => {
    expect(
      quizEventsResponseSchema.safeParse({ events: [validEvent] }).success
    ).toBe(false);
  });

  it('rejects an inverted legacy event window instead of normalizing it to zero', () => {
    expect(
      quizEventSchema.safeParse({
        ...validEvent,
        endsAt: '2026-05-20T09:59:00.000Z',
      }).success
    ).toBe(false);
  });

  it('keeps legitimate legacy prize metadata but rejects unknown event fields', () => {
    expect(
      quizEventSchema.safeParse({
        ...validEvent,
        prizeProduct: {
          id: '55555555-5555-4555-8555-555555555555',
          imageUrl: null,
          name: 'iPhone XR',
          variantId: null,
        },
      }).success
    ).toBe(true);
    expect(
      quizEventSchema.safeParse({
        ...validEvent,
        privateAdminSetting: 'must-not-reach-the-app',
      }).success
    ).toBe(false);
  });

  it('enforces question array and numeric boundaries', () => {
    const invalidFields = [
      [
        quizQuestionSchema.safeParse({ ...validQuestion, options: [] }),
        ['options'],
      ],
      [
        quizQuestionSchema.safeParse({ ...validQuestion, timeLimitSeconds: 0 }),
        ['timeLimitSeconds'],
      ],
      [quizQuestionSchema.safeParse({ ...validQuestion, index: 0 }), ['index']],
      [quizQuestionSchema.safeParse({ ...validQuestion, total: 0 }), ['total']],
      [
        quizEventSchema.safeParse({ ...validEvent, questionCount: 0 }),
        ['questionCount'],
      ],
      [
        quizResultSchema.safeParse({ ...completedResult, correctAnswers: -1 }),
        ['correctAnswers'],
      ],
      [
        quizResultSchema.safeParse({ ...completedResult, totalQuestions: 0 }),
        ['totalQuestions'],
      ],
      [
        quizResultSchema.safeParse({
          ...completedResult,
          correctAnswers: 4,
          totalQuestions: 3,
        }),
        ['correctAnswers'],
      ],
      [
        // Entry is free, so this is 0 and any non-negative int is accepted (a
        // stale database mid-deploy may still report 1). Only a negative charge
        // is nonsense.
        quizAttemptSchema.safeParse({
          ...validAttempt,
          examPassPointsSpent: -1,
        }),
        ['examPassPointsSpent'],
      ],
      [
        quizAttemptSchema.safeParse({
          ...validAttempt,
          remainingLoyaltyPoints: -1,
        }),
        ['remainingLoyaltyPoints'],
      ],
    ] as const;

    for (const [result, path] of invalidFields) {
      expectInvalidIssue(result, [...path]);
    }
  });

  it('accepts zero remaining loyalty points after spending the exam pass', () => {
    expect(
      quizAttemptSchema.safeParse({
        ...validAttempt,
        remainingLoyaltyPoints: 0,
      }).success
    ).toBe(true);
  });

  it('accepts only supported event and result statuses', () => {
    expect(
      quizEventSchema.safeParse({ ...validEvent, status: 'scheduled' }).success
    ).toBe(true);
    expect(
      quizEventSchema.safeParse({ ...validEvent, status: 'closed' }).success
    ).toBe(true);
    expectInvalidIssue(
      quizEventSchema.safeParse({ ...validEvent, status: 'paused' }),
      ['status']
    );

    expect(
      quizResultSchema.safeParse({
        ...completedResult,
        status: 'in_progress',
        question: validQuestion,
      }).success
    ).toBe(true);
    expectInvalidIssue(
      quizResultSchema.safeParse({ ...completedResult, status: 'failed' }),
      ['status']
    );
  });

  it('allows completed results without a next question', () => {
    expect(quizResultSchema.safeParse(completedResult).success).toBe(true);
  });

  it('requires a next question for in-progress results', () => {
    expectInvalidIssue(
      quizResultSchema.safeParse({
        ...completedResult,
        status: 'in_progress',
      }),
      ['question']
    );
    expect(
      quizResultSchema.safeParse({
        ...completedResult,
        status: 'in_progress',
        question: validQuestion,
      }).success
    ).toBe(true);
  });
});
