import { Alert } from 'react-native';

/**
 * Screen-wide utility checkout guard (Codex R77 6sNGO3).
 *
 * Each pager tab owns an independent submitting ref, so without this a
 * submit on one tab followed by a swipe + submit on another runs two
 * wallet debits concurrently. Both are legitimate intents — but the
 * first success unmounts the whole pager, and the still-mounted
 * handler then suppresses its completed receipt as off-screen, leaving
 * a debited purchase the customer was never shown.
 *
 * One checkout at a time: acquire after the gates pass, release in a
 * finally. Module scope (like the pending-VTU registries) so sibling
 * tabs share it without prop drilling.
 */

let utilityCheckoutInFlight = false;

/**
 * Claims the screen-wide checkout slot. False when another utility
 * checkout is already running — the caller must refuse (Alert) and
 * reset its own submitting state, NOT queue behind it.
 */
export function tryAcquireUtilityCheckout(): boolean {
  if (utilityCheckoutInFlight) {
    return false;
  }
  utilityCheckoutInFlight = true;
  return true;
}

/** Releases the slot. Safe to call without holding it (no-op). */
export function releaseUtilityCheckout(): void {
  utilityCheckoutInFlight = false;
}

/**
 * Acquires the slot, or refuses with an Alert when another checkout
 * is running. True means the caller now holds it (release in a
 * finally); false means refuse + reset submitting state, don't queue.
 */
export function acquireUtilityCheckoutOrAlert(): boolean {
  if (tryAcquireUtilityCheckout()) {
    return true;
  }
  Alert.alert(
    'Checkout in progress',
    'Please wait for the current purchase to finish before starting another one.'
  );
  return false;
}
