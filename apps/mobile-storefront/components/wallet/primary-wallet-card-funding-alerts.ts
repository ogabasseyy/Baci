import { Alert } from 'react-native';

/**
 * Maps a primary-card funding failure to user-facing guidance.
 * Distinguishable server rejections get specific copy (what to do next);
 * everything else keeps the generic retained-operation message.
 */
export function alertPrimaryWalletCardFundingFailure(error: unknown): void {
  const code =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  if (code === 'VERIFIED_EMAIL_REQUIRED') {
    Alert.alert(
      'Verify your email',
      'Card funding needs a verified email address. Verify it, then check this funding again — do not start another charge.'
    );
    return;
  }
  if (code === 'OWNERSHIP_REQUIRED') {
    Alert.alert(
      'Checkout belongs to another account',
      'This card checkout was started under a different customer. Sign in with that account before checking again.'
    );
    return;
  }
  Alert.alert(
    'Card funding could not be confirmed',
    'Any pending operation is retained. Check again before attempting another charge.'
  );
}
