type QuizRpcClientError = {
  code: string;
  error: string;
  status: number;
};

const ATTEMPT_LIMIT_ERROR: QuizRpcClientError = {
  code: 'QUIZ_ATTEMPT_LIMIT_REACHED',
  error: "You've reached the maximum number of attempts for this quiz.",
  status: 409,
};

const QUIZ_RPC_CLIENT_ERRORS: Record<string, QuizRpcClientError> = {
  QZ001: {
    code: 'QUIZ_CUSTOMER_NOT_FOUND',
    error: 'Quiz customer profile not found',
    status: 404,
  },
  QZ002: {
    code: 'QUIZ_EVENT_NOT_OPEN',
    error: 'Quiz event is not open',
    status: 409,
  },
  QZ003: {
    code: 'QUIZ_QUESTION_NOT_FOUND',
    error: 'Quiz has no available questions',
    status: 409,
  },
  QZ004: {
    code: 'QUIZ_ATTEMPT_NOT_READY',
    error: 'Quiz attempt is not ready for this action',
    status: 409,
  },
  QZ010: {
    code: 'QUIZ_ROUTE_PROOF_REQUIRED',
    error: 'Quiz request is not authorized',
    status: 403,
  },
  QZ012: {
    code: 'QUIZ_USERNAME_REQUIRED',
    error: 'Choose a username before starting the quiz',
    status: 409,
  },
  QZ013: {
    code: 'QUIZ_DATE_OF_BIRTH_REQUIRED',
    error: 'Add your date of birth before starting the quiz',
    status: 409,
  },
  QZ014: {
    code: 'QUIZ_AGE_RESTRICTED',
    error: 'You must be 18 or older to play this quiz',
    status: 403,
  },
  QZ020: {
    code: 'QUIZ_PRIZE_FINALIZATION_NOT_APPROVED',
    error: 'Quiz prize finalization is not approved',
    status: 403,
  },
  QZ021: {
    code: 'QUIZ_GRAND_PRIZE_CLAIM_NOT_APPROVED',
    error: 'Grand prize claim is not approved',
    status: 403,
  },
  QZ022: {
    code: 'QUIZ_CASH_AWARD_CLAIM_NOT_APPROVED',
    error: 'Cash award claim is not approved',
    status: 403,
  },
  QZ023: {
    code: 'QUIZ_GRAND_AWARD_NOT_CLAIMABLE',
    error: 'No approved grand prize is available to claim',
    status: 409,
  },
  QZ024: {
    code: 'QUIZ_CASH_AWARD_NOT_CLAIMABLE',
    error: 'No approved cash award is available to claim',
    status: 409,
  },
  QZ027: {
    code: 'QUIZ_QUESTION_NOT_ISSUED',
    error: 'Quiz question is not ready for answers',
    status: 409,
  },
  QZ028: {
    code: 'QUIZ_ANSWER_TOO_FAST',
    error: 'Quiz answer was submitted too quickly',
    status: 409,
  },
  QZ029: {
    code: 'QUIZ_ANSWER_TOO_LATE',
    error: 'Quiz answer was submitted after the question window',
    status: 409,
  },
  QZ030: ATTEMPT_LIMIT_ERROR,
  // Both caps apply across accounts. Keep the message deliberately vague so
  // it does not tell an abuser which signal to rotate.
  QZ040: ATTEMPT_LIMIT_ERROR,
  QZ041: ATTEMPT_LIMIT_ERROR,
  QZ042: {
    code: 'QUIZ_DEVICE_INVALID',
    error: 'This device could not be verified for the quiz.',
    status: 409,
  },
  QZ043: {
    code: 'QUIZ_DEVICE_CONFLICT',
    error: 'This quiz attempt is already linked to another device.',
    status: 409,
  },
  QZ044: {
    code: 'QUIZ_DEVICE_UNAVAILABLE',
    error: 'Device verification is temporarily unavailable.',
    status: 503,
  },
  QZ031: {
    code: 'QUIZ_LEADERBOARD_NOT_AUTHORIZED',
    error: 'You are not authorized to view this leaderboard',
    status: 403,
  },
  QZ400: {
    code: 'QUIZ_ACCEPTANCE_REQUIRED',
    error: 'Review and accept the current quiz rules.',
    status: 409,
  },
  QZ403: {
    code: 'QUIZ_TEST_ACCESS_REQUIRED',
    error: 'This private test quiz is not available to this account.',
    status: 403,
  },
};

export function mapQuizRpcClientError(
  value: unknown
): QuizRpcClientError | null {
  if (!value || typeof value !== 'object') return null;
  const code =
    'code' in value && typeof value.code === 'string' ? value.code : null;
  return code ? (QUIZ_RPC_CLIENT_ERRORS[code] ?? null) : null;
}
