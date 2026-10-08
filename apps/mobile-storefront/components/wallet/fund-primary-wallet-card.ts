import { router } from 'expo-router';
import { Alert } from 'react-native';
import {
  getPiggyvestPrimaryCapability,
  isPrimaryWalletNotReady,
} from '@/lib/piggyvest-primary-capability';
import { createPrimaryWalletCardFundingClient } from '@/lib/primary-wallet-card';
import { sanitizeWalletReturnTo } from '@/lib/sanitize-wallet-return-to';
import type { fundWallet } from './wallet-screen.handlers';

const client = createPrimaryWalletCardFundingClient();
let active = false;

export async function fundPrimaryWalletCard(
  input: Parameters<typeof fundWallet>[0]
) {
  if (active) return;
  const merchantId = input.activeMerchantId;
  const userId = input.user?.id;
  if (!merchantId || !userId) {
    Alert.alert(
      'Sign in required',
      'Please sign in again before card funding.'
    );
    return;
  }
  active = true;
  input.setIsFundPending(true);
  try {
    // Confirm the server capability before writing any pending funding
    // state: when primary is unconfigured the caller falls back to the
    // working legacy top-up instead of stranding a primary-only pending op.
    if (!(await getPiggyvestPrimaryCapability(merchantId))) {
      const unavailable = new Error(
        'Primary card funding is unavailable.'
      ) as Error & { code: string };
      unavailable.code = 'PRIMARY_CARD_NOT_READY';
      throw unavailable;
    }
    const pending = await client.readPending({ merchantId, userId });
    let result: Awaited<ReturnType<typeof client.start>>;
    if (pending) result = await client.recover({ merchantId, userId });
    else {
      const amountKobo = Math.round(Number(input.fundAmount) * 100);
      if (
        !Number.isSafeInteger(amountKobo) ||
        Math.abs(Number(input.fundAmount) * 100 - amountKobo) > 0.000001
      )
        throw new Error(
          'Enter an amount with no more than two decimal places.'
        );
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
      if (result.returnTo) router.replace(result.returnTo);
    } else
      Alert.alert(
        'Card funding pending',
        'This operation is saved. Check again later; do not start another card charge.'
      );
  } catch (error) {
    // Unconfigured primary is the caller's cue to run the legacy top-up;
    // rethrow without an alert so the fallback stays invisible.
    if (isPrimaryWalletNotReady(error)) throw error;
    Alert.alert(
      'Card funding could not be confirmed',
      'Any pending operation is retained. Check again before attempting another charge.'
    );
  } finally {
    active = false;
    input.setIsFundPending(false);
  }
}
