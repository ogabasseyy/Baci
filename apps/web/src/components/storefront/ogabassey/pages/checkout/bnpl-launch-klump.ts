import type { BnplLaunchOrderContext } from './bnpl-launch-context';

// Historical callback handling still uses this provider redirect marker.
export const KLUMP_REDIRECT_URL_KEY = 'klump_redirect_url';

/** Prevent bookmarked launcher URLs from starting another retired provider flow. */
export async function launchKlumpCheckout({
  setStatus,
  setErrorMessage,
}: BnplLaunchOrderContext): Promise<void> {
  setStatus('error');
  setErrorMessage(
    'Klump is no longer available. Please choose another payment method.'
  );
}
