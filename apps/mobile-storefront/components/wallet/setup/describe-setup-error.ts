// Server codes where refreshing cannot help; only waiting can.
const SETUP_UNAVAILABLE_CODES = new Set([
  'PROVIDER_UNAVAILABLE',
  'NOT_CONFIGURED',
  'PIGGYVEST_NOT_READY',
  'PIGGYVEST_ONBOARDING_NOT_READY',
  'PIGGYVEST_UNAVAILABLE',
]);

/**
 * Turns a failed savings wallet setup into what the customer sees, and where:
 * a rejected BVN belongs under the BVN field (and the known-wrong number is
 * dropped); everything else is a form-level message. Provider text is never
 * shown.
 */
export function describeSetupError(error: unknown): {
  field: 'bvn' | 'form';
  message: string;
  clearBvn: boolean;
} {
  const code =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  if (code === 'INVALID_BVN')
    return {
      field: 'bvn',
      message: 'That BVN was rejected. Check the number and try again.',
      clearBvn: true,
    };
  if (code === 'PROFILE_VERIFICATION_REQUIRED')
    return {
      field: 'form',
      message:
        'Please verify your email and complete your profile, then try again.',
      clearBvn: false,
    };
  if (typeof code === 'string' && SETUP_UNAVAILABLE_CODES.has(code))
    return {
      field: 'form',
      message: 'Wallet setup is unavailable right now. Please try again later.',
      clearBvn: false,
    };
  return {
    field: 'form',
    message:
      'Wallet setup could not be confirmed. Refresh your account before trying again.',
    clearBvn: false,
  };
}
