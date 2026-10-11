import { router } from 'expo-router';
import { Alert } from 'react-native';
import { getWalletReturnHref } from '@/components/payment-gateway/payment-gateway-controller.helpers';
import {
  getPiggyvestPrimaryCapability,
  isVerifiedEmailRequired,
  rollbackObservedCapabilityOnNotReady,
} from '@/lib/piggyvest-primary-capability';
import { createPrimaryWalletCardFundingClient } from '@/lib/primary-wallet-card';
import { sanitizeWalletReturnTo } from '@/lib/sanitize-wallet-return-to';
import { validateFundAmountKobo } from './fund-primary-wallet-card-amount';
import {
  alertPrimaryWalletCardEmailFallback,
  alertPrimaryWalletCardFundingFailure,
} from './primary-wallet-card-funding-alerts';
import type { fundWallet } from './wallet-screen.handlers';

const client = createPrimaryWalletCardFundingClient();
const activeFundings = new Set<string>();
// The consent this screen collects: one-time charge, never save the card.
// The adoption dialog compares only the echoed save-card choice because
// version and oneTimeCharge are schema-pinned literals on both client
// and server (and the server echoes saveCard alone): drift there is
// unrepresentable, so saveCard is the only user-visible variable. The
// contract test below fails if those pins are ever loosened, forcing
// this dialog to be revisited.
const ENTERED_CONSENT = {
  version: 'primary-wallet-card-v1',
  oneTimeCharge: true,
  saveCard: false,
} as const;

function formatNairaFromKobo(amountKobo: number): string {
  // Render from the integer kobo value, not the raw input string, so the
  // consent prompt always shows exactly what will be charged. Decimals
  // are manual (integer grouping uses the codebase's en-NG convention)
  // so every JS engine formats identically.
  const whole = Math.floor(amountKobo / 100).toLocaleString('en-NG');
  const koboPart = String(amountKobo % 100).padStart(2, '0');
  return `${whole}.${koboPart}`;
}

function formatGatewayAmountNaira(amountKobo: number): string {
  // Integer-derived (never float division): the gateway amount is
  // display-only — the charge binds to the operation server-side — but it
  // must still match the consented integer-kobo figure exactly at every
  // magnitude the schema allows.
  const whole = Math.floor(amountKobo / 100);
  const kobo = amountKobo % 100;
  return kobo === 0
    ? String(whole)
    : `${whole}.${String(kobo).padStart(2, '0')}`;
}

export async function fundPrimaryWalletCard(
  input: Parameters<typeof fundWallet>[0]
) {
  const merchantId = input.activeMerchantId;
  const userId = input.user?.id;
  if (!merchantId || !userId) {
    Alert.alert(
      'Sign in required',
      'Please sign in again before card funding.'
    );
    return;
  }
  // Debounce repeat taps per funding scope: a global flag would silently
  // drop a second account's funding while another is in flight. The key
  // stays scope-wide (never amount-scoped: parallel charges for one scope
  // could double-charge), but a dropped tap says so instead of returning
  // silently — a changed amount must never be mistaken for submitted.
  const fundingKey = `${merchantId} ${userId}`;
  if (activeFundings.has(fundingKey)) {
    Alert.alert(
      'Funding in progress',
      'Your card funding is already running. Wait for it to finish before starting another.'
    );
    return;
  }
  activeFundings.add(fundingKey);
  input.setIsFundPending(true);
  let pending: Awaited<ReturnType<typeof client.readPending>> = null;
  try {
    // Inspect the locally saved operation before probing server
    // capability: readPending never touches the network, and a saved
    // checkout may already have charged the card. Only when no operation
    // exists is it safe to report primary unavailable so the caller can
    // run the legacy top-up instead.
    pending = await client.readPending({ merchantId, userId });
    if (!pending && !(await getPiggyvestPrimaryCapability(merchantId))) {
      const unavailable = new Error(
        'Primary card funding is unavailable.'
      ) as Error & { code: string };
      unavailable.code = 'PRIMARY_CARD_NOT_READY';
      throw unavailable;
    }
    let result: Awaited<ReturnType<typeof client.start>>;
    if (pending) result = await client.recover({ merchantId, userId });
    else {
      const validated = validateFundAmountKobo(input.fundAmount);
      if ('error' in validated) {
        // Invalid input is a user error, not a failed charge: say so
        // directly instead of falling into the retained-operation alert.
        Alert.alert('Check the amount', validated.error);
        return;
      }
      const amountKobo = validated.amountKobo;
      const accepted = await new Promise<boolean>((resolve) =>
        Alert.alert(
          'Confirm card wallet funding',
          `Authorize a one-time ₦${formatNairaFromKobo(amountKobo)} charge to fund your wallet. Your card will not be saved. Money appears in your wallet after funding is confirmed.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Authorize one-time charge', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) }
        )
      );
      if (!accepted) return;
      result = await client.start({
        merchantId,
        userId,
        amountKobo,
        consent: { ...ENTERED_CONSENT },
        returnTo: sanitizeWalletReturnTo(input.walletReturnTo),
      });
    }
    // Account-switch guard: the awaits above (storage, probe, dialogs,
    // network) can span an auth change. Never display or navigate to a
    // checkout bound to a different account than the one now signed in —
    // the new account must not enter card details into a checkout whose
    // immutable destination is the previous account's wallet. The
    // operation stays saved (only the display is skipped), so its owner
    // recovers it on their next attempt. The message reveals nothing
    // about the other account's funding. Lazy-loaded so this module
    // stays light: a static auth-store import would drag the whole
    // storage/push chain into every importer of the wallet handlers.
    const { useAuthStore } =
      require('@/stores/auth-store') as typeof import('@/stores/auth-store');
    const activeAccountChanged = () =>
      useAuthStore.getState().user?.id !== userId;
    const rejectAccountSwitch = () => {
      Alert.alert(
        'Signed-in account changed',
        'You switched accounts during card funding. Any pending funding stays saved under the previous account.'
      );
      input.resetFundPanel();
    };
    if (activeAccountChanged()) {
      rejectAccountSwitch();
      return;
    }
    // Closed checkout, adopted or not: the service terminalized the
    // operation as abandoned (duplicate deterministic reference after an
    // ambiguous retry) and the client already dropped its saved record,
    // so the next attempt starts fresh. This must not depend on the
    // adoption flag — matching amount/consent skips adoption, but the
    // fallback below would then wrongly claim an operation is saved.
    if (result.status === 'abandoned') {
      Alert.alert(
        'Previous funding closed',
        'Your earlier card funding could not complete. Start a new funding with the amount you want.'
      );
      input.resetFundPanel();
      return;
    }
    // Adopted checkout: the server resumed the customer's stored
    // unresolved operation (lost device storage, re-entered amount or
    // consent) instead of the just-entered values. Never open its checkout
    // silently — the consent prompt showed a different figure or save-card
    // choice — so confirm the stored values first.
    if ('adopted' in result && result.adopted) {
      const consentChanged =
        result.saveCard !== undefined &&
        result.saveCard !== ENTERED_CONSENT.saveCard;
      const resume = await new Promise<boolean>((resolve) =>
        Alert.alert(
          'Resume pending funding',
          consentChanged
            ? `Found your pending ₦${formatNairaFromKobo(result.amountKobo)} card funding. It was set up to save your card for faster checkout. Continue?`
            : `Found your pending ₦${formatNairaFromKobo(result.amountKobo)} card funding. Continue with this amount?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            {
              text: `Resume ₦${formatNairaFromKobo(result.amountKobo)}`,
              onPress: () => resolve(true),
            },
          ],
          { cancelable: true, onDismiss: () => resolve(false) }
        )
      );
      if (!resume) {
        Alert.alert(
          'Card funding pending',
          'This operation is saved. Check again later; do not start another card charge.'
        );
        return;
      }
    }
    // Re-read after the resume confirmation: the prompt above awaits user
    // input, so the account may have changed since the guard above. Never
    // navigate to a checkout bound to the previous account.
    if (activeAccountChanged()) {
      rejectAccountSwitch();
      return;
    }
    if (result.status === 'ready' && result.authorizationUrl) {
      input.resetFundPanel();
      router.push({
        pathname: '/payment-gateway',
        params: {
          paymentKind: 'primary_wallet_card',
          gateway: 'paystack',
          merchantId,
          // Initiating-user stamp: the mounted checkout compares this
          // against the active identity and blocks the WebView after an
          // account switch, so another user can never enter card
          // details into this account's charge.
          userId,
          authorizationUrl: result.authorizationUrl,
          reference: result.reference,
          amount: formatGatewayAmountNaira(result.amountKobo),
          ...(result.returnTo ? { returnTo: result.returnTo } : {}),
        },
      });
    } else if (result.status === 'completed') {
      // Refresh before confirming: the user lands on the wallet balance,
      // which would otherwise stay stale until a manual refresh.
      await input.refetchWalletBalance?.().catch(() => undefined);
      Alert.alert('Funding confirmed', 'Your wallet funding is confirmed.');
      input.resetFundPanel();
      // Re-sanitize at the navigation boundary: the saved handoff was
      // validated at write time, but storage is outside our trust.
      if (result.returnTo) router.replace(getWalletReturnHref(result.returnTo));
    } else
      Alert.alert(
        'Card funding pending',
        'This operation is saved. Check again later; do not start another card charge.'
      );
  } catch (error) {
    // Unverified email falls back to the legacy top-up (which has no
    // email gate) with a nudge explaining why: the 409 fires before any
    // reservation, so nothing is retained and the customer still funds
    // today. The fallback cue reuses the caller's NOT_READY contract,
    // but the merchant verdict is untouched — this is per-user
    // eligibility, not configuration — and a retained checkout (recovery
    // racing verification) keeps the nudge-only path below.
    if (isVerifiedEmailRequired(error)) {
      const retained = await client
        .readPending({ merchantId, userId })
        .catch(() => pending);
      if (!retained) {
        alertPrimaryWalletCardEmailFallback();
        const fallback = new Error(
          'Primary card funding needs a verified email.'
        ) as Error & { code: string };
        fallback.code = 'PRIMARY_CARD_NOT_READY';
        throw fallback;
      }
    }
    // Unconfigured primary is the caller's cue to run the legacy top-up,
    // but only when nothing is retained: a found checkout may already have
    // charged the card, so keep it and surface the failure. Re-read on
    // not-ready because the request drops its own null-operation
    // placeholder, which must not block fallback either.
    if (rollbackObservedCapabilityOnNotReady(merchantId, error)) {
      const retained = await client
        .readPending({ merchantId, userId })
        .catch(() => pending);
      if (!retained) throw error;
    }
    alertPrimaryWalletCardFundingFailure(error);
  } finally {
    activeFundings.delete(fundingKey);
    input.setIsFundPending(false);
  }
}
