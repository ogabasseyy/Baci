import { Alert } from 'react-native';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { discardUnreadablePrimaryCardFunding } from './discard-unreadable-primary-card-funding';
import { askWalletFund } from './fund/ask-wallet-fund';
import { walletOutcomeNotifier } from './fund/wallet-outcome-notifier';
import { isSameSignedInUser } from './is-same-signed-in-user';

const TITLE = 'Earlier card payment unreadable';
const MESSAGE =
  'We could not read an earlier card payment on this device. If it was charged, the money will still appear in your savings wallet. Continue to add store credit for this purchase?';
const CONFIRM = 'Continue anyway';
const ACCOUNT_CHANGED =
  'You switched accounts. Start the top-up again from this account.';
const STORAGE_FAILED =
  'We could not clear the earlier card payment from this device. Please try again in a moment.';

/**
 * A saved card funding we can't read may still charge (Codex): the customer
 * cancels, or knowingly clears it and continues. Asked in the sheet at the
 * PiggyVest store (owner: no alerts on fund screens), as today's alert
 * elsewhere.
 */
export function confirmDiscardUnreadableFunding({
  merchantId,
  onRetry,
  userId,
}: {
  merchantId?: string;
  onRetry?: () => void;
  userId?: string;
}): void {
  const notify = walletOutcomeNotifier(merchantId);
  const proceed = () => {
    // The question can outlive an account switch (Codex): continue only for
    // the account that started it.
    if (!isSameSignedInUser(userId)) {
      notify(
        {
          title: 'Signed-in account changed',
          message: ACCOUNT_CHANGED,
          tone: 'warning',
        },
        { title: 'Signed-in account changed', message: ACCOUNT_CHANGED }
      );
      return;
    }
    void discardUnreadablePrimaryCardFunding(merchantId, userId).then(
      (cleared) => {
        if (cleared) {
          onRetry?.();
          return;
        }
        // Storage kept the record (Codex): retrying would reopen this.
        notify(
          {
            title: 'Could not update this device',
            message: STORAGE_FAILED,
            tone: 'warning',
          },
          { title: 'Could not update this device', message: STORAGE_FAILED }
        );
      }
    );
  };
  if (isPiggyvestPrimaryMerchant(merchantId)) {
    void askWalletFund(TITLE, MESSAGE, CONFIRM).then((confirmed) => {
      if (confirmed) proceed();
    });
    return;
  }
  Alert.alert(TITLE, MESSAGE, [
    { text: 'Cancel', style: 'cancel' },
    { text: CONFIRM, onPress: proceed },
  ]);
}
