import { router } from 'expo-router';

/**
 * Back from the stacked wallet page. When nothing is underneath (e.g. sign-in
 * replaced the stack with /wallet), fall back to the Wallet tab so the
 * customer is never stranded without a tab bar.
 */
export function leaveStackedWallet(): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace('/(tabs)/wallet');
}
