import { describe, expect, it } from 'vitest';
import { QUIZ_AGE_RESTRICTED_MESSAGE } from '@/schemas/quiz-age-gate-message';
import { mapQuizRpcClientError } from './quiz-rpc-client-errors';

describe('mapQuizRpcClientError', () => {
  it('maps safe client-facing quiz RPC errors', () => {
    expect(mapQuizRpcClientError({ code: 'QZ012' })).toEqual({
      code: 'QUIZ_USERNAME_REQUIRED',
      error: 'Choose a username before starting the quiz',
      status: 409,
    });
    expect(mapQuizRpcClientError({ code: 'QZ040' })).toMatchObject({
      code: 'QUIZ_ATTEMPT_LIMIT_REACHED',
      status: 409,
    });
  });

  it('maps the database age gate (QZ014) to a 403 for under-18 players', () => {
    expect(mapQuizRpcClientError({ code: 'QZ014' })).toEqual({
      code: 'QUIZ_AGE_RESTRICTED',
      error: QUIZ_AGE_RESTRICTED_MESSAGE,
      status: 403,
    });
  });

  it('does not expose unknown or malformed database errors', () => {
    expect(mapQuizRpcClientError({ code: 'XX001', message: 'secret' })).toBe(
      null
    );
    expect(mapQuizRpcClientError(null)).toBe(null);
  });
});
