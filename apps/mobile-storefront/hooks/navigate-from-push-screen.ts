import { type Href, router } from 'expo-router';
import { logger } from '@/lib/logger';
import { resolveActiveCustomerId } from '@/lib/resolve-active-customer-id';
import { sanitizeResumableWalletReturnTo } from '@/lib/resumable-wallet-return-to';
import {
  clearWalletFundingIntent,
  consumeWalletFundingIntent,
} from '@/lib/wallet-funding-intent';

/**
 * Fallback for wallet credits that carry no `returnTo`: DVA / bank-transfer
 * top-ups have no client `initialize` call (the DVA is a standing account
 * number, and the transaction row is created by the webhook itself), so their
 * metadata can never hold the onward destination the way a card top-up's does.
 * The intent recorded locally when the customer opened the funding surface is
 * single-use, TTL-bounded, owned by ONE customer, and re-validated against the
 * same strict resumable allowlist before it is navigated to.
 *
 * The owner check is why the active customer is resolved (awaiting auth
 * hydration) before the read: a credit for customer B must never resume — and
 * must not leave armed — an intent that customer A left on a shared device.
 */
async function resumeStoredWalletFundingIntent(isCurrent: () => boolean) {
  const customerId = await resolveActiveCustomerId();
  if (!isCurrent()) return;
  if (!customerId) {
    router.push('/wallet');
    return;
  }
  const storedReturnTo = await consumeWalletFundingIntent(
    customerId,
    isCurrent
  );
  if (!isCurrent()) return;
  // Consume first: mounting a bare wallet route clears stale intent state.
  // Only navigate after the single-use record is safely read and removed.
  router.push('/wallet');
  if (storedReturnTo) {
    router.push(storedReturnTo);
  }
}

// Module-scope routing dispatcher for notification taps. Kept out of the hook
// body so the useEffectEvent wrapper stays thin; behavior is unchanged.
export function navigateFromPushScreen(
  screen: string,
  params?: Record<string, string>,
  isCurrent: () => boolean = () => true
): void | Promise<void> {
  if (!isCurrent()) return;
  switch (screen) {
    case 'order-details':
      // Missing id would push to `/orders/undefined`; fall back to the list.
      if (params?.id) {
        router.push(`/orders/${params.id}`);
      } else {
        router.push('/orders');
      }
      break;
    case 'orders':
      router.push('/orders');
      break;
    case 'repairs':
      router.push('/repairs');
      break;
    case 'product':
      if (params?.slug) {
        router.push(`/product/${params.slug}`);
      } else {
        router.push('/');
      }
      break;
    case 'category':
      if (params?.slug) {
        router.push(`/category/${params.slug}` as Href);
      } else {
        router.push('/');
      }
      break;
    case 'wallet': {
      if (params?.action === 'savings') {
        router.push({
          pathname: '/wallet',
          params: { action: 'savings' },
        });
        break;
      }
      // Wallet-credited taps may carry an onward destination (the interrupted
      // purchase). A generic "is internal path" check is NOT enough here: an
      // internal redirector such as `/auth/callback?returnTo=//evil.com` is an
      // internal path yet forwards control to an attacker-chosen destination.
      // So this uses the strict resumable-destination allowlist (checkout,
      // imei-check, utilities/<type>) shared with the server persist path. Land
      // on the wallet FIRST (the credit context) and resume the destination on
      // top — back returns to the wallet, matching the "Return to your
      // purchase" promise.
      const returnTo = sanitizeResumableWalletReturnTo(params?.returnTo);

      // ONLY an actual credit may touch the pending funding intent. Other pushes
      // also land on the wallet (`vtu_cashback_monthly_summary`), and they are
      // otherwise indistinguishable from a returnTo-less credit — consuming the
      // intent for one of those would both misfire a navigation and burn the
      // single-use intent before the real credit lands.
      if (params?.credited !== 'true') {
        router.push('/wallet');
        break;
      }

      if (returnTo) {
        // The payload's destination wins; the locally recorded intent is now
        // superseded, so drop it rather than leave it armed for a later credit.
        void clearWalletFundingIntent();
        router.push('/wallet');
        router.push(returnTo);
        break;
      }
      // No usable destination in the payload (bank-transfer/DVA credits never
      // carry one) — resume the locally recorded funding intent, if any.
      return resumeStoredWalletFundingIntent(isCurrent).catch((error) => {
        logger.warn(
          'PushNavigation',
          'Failed to resume wallet funding intent:',
          error
        );
        if (isCurrent()) router.push('/wallet');
      });
    }
    case 'utility-history':
      router.push(`/utilities/history?type=${params?.type ?? 'power'}` as Href);
      break;
    case 'unlock-orders':
      router.push('/unlock-orders');
      break;
    default:
      router.push('/');
  }
}
