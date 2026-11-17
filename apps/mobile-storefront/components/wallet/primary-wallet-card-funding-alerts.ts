import type { SavingsNotify } from './savings/savings-notifier';

/**
 * Maps a primary-card funding failure to user-facing guidance, shown as the
 * wallet notice (never an iOS alert). Distinguishable server rejections get
 * specific copy (what to do next); everything else keeps the generic
 * retained-operation message.
 */
export function alertPrimaryWalletCardFundingFailure(
  error: unknown,
  notify: SavingsNotify
): void {
  const code =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  if (code === 'VERIFIED_EMAIL_REQUIRED') {
    notify(
      'Verify your email',
      'Card funding needs a verified email address. Verify it, then check this funding again — do not start another charge.',
      'warning'
    );
    return;
  }
  if (code === 'OWNERSHIP_REQUIRED') {
    notify(
      'Checkout belongs to another account',
      'This card checkout was started under a different customer. Sign in with that account before checking again.',
      'warning'
    );
    return;
  }
  notify(
    'Card funding could not be confirmed',
    'Any pending operation is retained. Check again before attempting another charge.',
    'warning'
  );
}

/**
 * Nudge shown when an unverified customer falls back to the legacy
 * top-up (which has no email gate). Unlike the retained-operation copy
 * above, this must not say "do not start another charge" — the legacy
 * top-up starts immediately after this notice.
 */
export function alertPrimaryWalletCardEmailFallback(
  notify: SavingsNotify
): void {
  notify(
    'Verify your email for card funding',
    'Card funding needs a verified email address. Continuing with standard top-up instead — verify your email to unlock card funding next time.'
  );
}
