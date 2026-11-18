import { describe, expect, it } from 'vitest';
import {
  QuizAppAttestationError,
  quizAppAttestationErrorResponse,
} from './quiz-app-attestation-error';

describe('quizAppAttestationErrorResponse', () => {
  it('returns a 403 with a stable code and no verifier detail', async () => {
    const response = quizAppAttestationErrorResponse(
      new QuizAppAttestationError()
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: 'QUIZ_APP_ATTESTATION_REQUIRED',
      error: 'Open the Ogabassey app to play prize quizzes.',
    });
  });
});
