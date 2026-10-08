import { router } from 'expo-router';
import { Alert } from 'react-native';
import { getWalletReturnHref } from '@/components/payment-gateway/payment-gateway-controller.helpers';
import {
  getPiggyvestPrimaryCapability,
  isPrimaryWalletNotReady,
} from '@/lib/piggyvest-primary-capability';
import { createPrimaryWalletCardFundingClient } from '@/lib/primary-wallet-card';
import { sanitizeWalletReturnTo } from '@/lib/sanitize-wallet-return-to';
import type { fundWallet } from './wallet-screen.handlers';

const client = createPrimaryWalletCardFundingClient();
const activeFundings = new Set<string>();

function validateFundAmountKobo(fundAmount: unknown): string | null {
  const amountKobo = Math.round(Number(fundAmount) * 100);
  if (
    !Number.isSafeInteger(amountKobo) ||
    Math.abs(Number(fundAmount) * 100 - amountKobo) > 0.000001
  )
    return 'Enter an amount with no more than two decimal places.';
  if (amountKobo <= 0) return 'Enter an amount greater than zero.';
  if (amountKobo > 9999999999) return 'Enter a smaller amount.';
  return null;
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
      const amountError = validateFundAmountKobo(input.fundAmount);
      if (amountError) {
        // Invalid input is a user error, not a failed charge: say so
        // directly instead of falling into the retained-operation alert.
        Alert.alert('Check the amount', amountError);
        return;
      }
      const amountKobo = Math.round(Number(input.fundAmount) * 100);
      const accepted = await new Promise<boolean>((resolve) =>
        Alert.alert(
          'Confirm card wallet funding',
          `Authorize a one-time ₦${Number(input.fundAmount).toLocaleString()} charge to fund your wallet. Your card will not be saved. Money appears in your wallet after funding is confirmed.`,
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
        consent: {
          version: 'primary-wallet-card-v1',
          oneTimeCharge: true,
          saveCard: false,
        },
        returnTo: sanitizeWalletReturnTo(input.walletReturnTo),
      });
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
          amount: String(result.amountKobo / 100),
          ...(result.returnTo ? { returnTo: result.returnTo } : {}),
        },
      });
    } else if (result.status === 'completed') {
      Alert.alert(
        'Funding confirmed',
        'Your wallet funding is confirmed. Refresh your wallet balance.'
      );
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
    // but only when no saved operation exists: a found checkout may
    // already have charged the card, so keep it and surface the failure.
    if (!pending && isPrimaryWalletNotReady(error)) throw error;
    Alert.alert(
      'Card funding could not be confirmed',
      'Any pending operation is retained. Check again before attempting another charge.'
    );
  } finally {
    activeFundings.delete(fundingKey);
    input.setIsFundPending(false);
  }
}
