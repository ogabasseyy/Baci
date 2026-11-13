import { currentSavingsNoticeScope } from '../savings/savings-notice-store';
import { useWalletFundPromptStore } from './wallet-fund-prompt-store';

/**
 * Asks a funding question inline and resolves with the answer. A newer
 * question replaces an older one, which resolves as declined: nothing is
 * ever confirmed by a question the customer can no longer see.
 */
export function askWalletFund(
  title: string,
  message: string,
  confirmLabel: string
): Promise<boolean> {
  return new Promise((resolve) => {
    useWalletFundPromptStore.getState().prompt?.resolve(false);
    useWalletFundPromptStore.setState({
      prompt: {
        title,
        message,
        confirmLabel,
        scope: currentSavingsNoticeScope(),
        resolve,
      },
    });
  });
}
