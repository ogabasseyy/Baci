import { NextResponse } from 'next/server';

/**
 * A live prize start from a bearer session must carry proof that it came from
 * the genuine Ogabassey app on a real device. A bearer token alone is not that
 * proof: a shopper can copy their own token and replay it from a script.
 */
export class QuizAppAttestationError extends Error {
  readonly code = 'QUIZ_APP_ATTESTATION_REQUIRED';

  constructor() {
    super('Open the Ogabassey app to play prize quizzes.');
    this.name = 'QuizAppAttestationError';
  }
}

export function quizAppAttestationErrorResponse(
  error: QuizAppAttestationError
) {
  return NextResponse.json(
    { code: error.code, error: error.message },
    { status: 403 }
  );
}
