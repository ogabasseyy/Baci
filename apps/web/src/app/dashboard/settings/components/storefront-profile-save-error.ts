/**
 * The guarded identity RPC rejects with bare codes such as
 * `invalid_support_phone`. Contact numbers are sensitive fields, so changing
 * the business phone also needs a recent sign-in. Turn the codes a merchant
 * can act on into plain guidance; anything else keeps its original message.
 */
const SAVE_ERROR_MESSAGES: ReadonlyArray<readonly [string, string]> = [
  [
    'invalid_support_phone',
    'A phone number looks incomplete. Enter the full number with its country code, for example +234 801 234 5678.',
  ],
  [
    'merchant_settings_reauthentication_required',
    'Sign in again before changing your contact details.',
  ],
  [
    'merchant_settings_mfa_required',
    'Verify your second factor before changing your contact details.',
  ],
];

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const { message } = error as { message: unknown };
    if (typeof message === 'string') return message;
  }
  return String(error);
}

export function toStorefrontProfileSaveError(error: unknown): Error {
  const message = readErrorMessage(error);
  const friendly = SAVE_ERROR_MESSAGES.find(([code]) =>
    message.includes(code)
  )?.[1];

  if (friendly) return new Error(friendly, { cause: error });
  return error instanceof Error ? error : new Error(message, { cause: error });
}
