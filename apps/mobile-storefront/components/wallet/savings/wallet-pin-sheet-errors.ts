import { messageOf as goalMessageOf } from './goal-lifecycle-outcomes';

// Codes the PIN service sends with copy written for the customer.
const SAFE_PIN_CODES: ReadonlySet<string> = new Set([
  'PIN_ALREADY_SET',
  'PIN_BUSY',
  'PIN_INCORRECT',
  'PIN_LOCKED',
  'PIN_NOT_SET',
  'PIN_RESET_REQUIRED',
  'PIN_UNAVAILABLE',
]);
const FALLBACK_ERROR = 'Something went wrong. Please try again.';

export function pinMessageOf(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : FALLBACK_ERROR;
}

export function pinCodeOf(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

// Goal cancel / complete never shows raw network, parse or server text: only
// PIN-service copy and the goal flow's own safe codes get through.
export function goalActionMessageOf(error: unknown) {
  const code = pinCodeOf(error);
  return code && SAFE_PIN_CODES.has(code) && error instanceof Error
    ? pinMessageOf(error)
    : goalMessageOf(error);
}
