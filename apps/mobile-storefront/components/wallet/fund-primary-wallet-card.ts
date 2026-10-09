import { router } from 'expo-router';
import { Alert } from 'react-native';
import { getWalletReturnHref } from '@/components/payment-gateway/payment-gateway-controller.helpers';
import {
  getPiggyvestPrimaryCapability,
  rollbackObservedCapabilityOnNotReady,
} from '@/lib/piggyvest-primary-capability';
import { createPrimaryWalletCardFundingClient } from '@/lib/primary-wallet-card';
import { sanitizeWalletReturnTo } from '@/lib/sanitize-wallet-return-to';
import { PRIMARY_WALLET_CARD_MIN_AMOUNT_KOBO } from '@/schemas/primary-wallet-card';
import type { fundWallet } from './wallet-screen.handlers';

const client = createPrimaryWalletCardFundingClient();
const activeFundings = new Set<string>();
// The consent this screen collects: one-time charge, never save the card.
// The adoption dialog compares the stored checkout's echoed save-card
// choice against this — a stored checkout that would save the card must
// say so, because the consent prompt promised it will not be saved.
const ENTERED_CONSENT = {
  version: 'primary-wallet-card-v1',
  oneTimeCharge: true,
  saveCard: false,
} as const;

const MAX_FUND_AMOUNT_KOBO = 9999999999;

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

function parseFundAmountKobo(fundAmount: unknown): number | null {
  if (typeof fundAmount !== 'string') return null;
  // Normalize display/user input (surrounding whitespace, thousands
  // separators), then require a plain shape: digits with at most two
  // decimals. Bare Number() would also accept exponents, hex, and signs,
  // which must never silently become a charge amount.
  const normalized = fundAmount.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  // Integer-only conversion: the shape above guarantees digits with at most
  // two decimals, so scale by string splitting — never a float multiply.
  const [whole, fraction = ''] = normalized.split('.');
  const amountKobo = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amountKobo) ? amountKobo : null;
}

function validateFundAmountKobo(
  fundAmount: unknown
): { amountKobo: number } | { error: string } {
  const amountKobo = parseFundAmountKobo(fundAmount);
  if (amountKobo === null) {
    const text =
      typeof fundAmount === 'string' ? fundAmount.trim().replace(/,/g, '') : '';
    if (text === '') return { error: 'Enter an amount greater than zero.' };
    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric <= 0)
      return { error: 'Enter an amount greater than zero.' };
    if (Number.isFinite(numeric))
      return {
        error: 'Enter an amount with no more than two decimal places.',
      };
    return { error: 'Enter a valid amount using digits only.' };
  }
  if (amountKobo <= 0) return { error: 'Enter an amount greater than zero.' };
  // Same floor as the charge schema: failing here shows a specific
  // correctable error before consent instead of a generic
  // retained-operation message after it.
  if (amountKobo < PRIMARY_WALLET_CARD_MIN_AMOUNT_KOBO)
    return { error: 'Enter an amount of at least ₦50.00.' };
  if (amountKobo > MAX_FUND_AMOUNT_KOBO)
    return { error: 'Enter a smaller amount.' };
  return { amountKobo };
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
  // drop a second account's funding while another is in flight.
  const fundingKey = `${merchantId} ${userId}`;
  if (activeFundings.has(fundingKey)) return;
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
    // Adopted checkout: the server resumed the customer's stored
    // unresolved operation (lost device storage, re-entered amount or
    // consent) instead of the just-entered values. Never open its checkout
    // silently — the consent prompt showed a different figure or save-card
    // choice — so confirm the stored values first. A closed adoption just
    // reports; the saved record was already dropped so the next attempt
    // starts fresh.
    if ('adopted' in result && result.adopted) {
      if (result.status === 'abandoned') {
        Alert.alert(
          'Previous funding closed',
          'Your earlier card funding could not complete. Start a new funding with the amount you want.'
        );
        input.resetFundPanel();
        return;
      }
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
    Alert.alert(
      'Card funding could not be confirmed',
      'Any pending operation is retained. Check again before attempting another charge.'
    );
  } finally {
    activeFundings.delete(fundingKey);
    input.setIsFundPending(false);
  }
}
