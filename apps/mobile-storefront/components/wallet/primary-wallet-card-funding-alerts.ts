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

/**
 * Nudge shown when an unverified customer falls back to the legacy
 * top-up (which has no email gate). Unlike the retained-operation copy
 * above, this must not say "do not start another charge" — the legacy
 * top-up starts immediately after this alert.
 */
export function alertPrimaryWalletCardEmailFallback(): void {
  Alert.alert(
    'Verify your email for card funding',
    'Card funding needs a verified email address. Continuing with standard top-up instead — verify your email to unlock card funding next time.'
  );
}
