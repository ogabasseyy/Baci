import { NextResponse } from 'next/server';

/**
 * Live prize quizzes are played in the Ogabassey app only. The website has the
 * weaker integrity tier (browser cookie device identity), so a browser-session
 * start of a live event is refused before any attempt is created.
 */
export class QuizAppOnlyError extends Error {
  readonly code = 'QUIZ_APP_ONLY';

  constructor() {
    super('Prize quizzes are played in the Ogabassey app.');
    this.name = 'QuizAppOnlyError';
  }
}

export function quizAppOnlyErrorResponse(error: QuizAppOnlyError) {
  return NextResponse.json(
    { code: error.code, error: error.message },
    { status: 403 }
  );
}
