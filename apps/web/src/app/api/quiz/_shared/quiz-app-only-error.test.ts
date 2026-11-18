import { describe, expect, it } from 'vitest';
import {
  QuizAppOnlyError,
  quizAppOnlyErrorResponse,
} from './quiz-app-only-error';

describe('quiz app-only error', () => {
  it('maps to a 403 with a stable code and shopper-safe message', async () => {
    const response = quizAppOnlyErrorResponse(new QuizAppOnlyError());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: 'QUIZ_APP_ONLY',
      error: 'Prize quizzes are played in the Ogabassey app.',
    });
  });

  it('is a named Error subclass', () => {
    const error = new QuizAppOnlyError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('QuizAppOnlyError');
  });
});
