export const WALLET_TRANSFER_CHECKING_COPY =
  'Checking whether bank transfer to wallet is available…';

const WALLET_TRANSFER_DESCRIPTION =
  'A permanent account number will be created for you which you can use for future purchases. We apply it to this order automatically.';

/**
 * The bank-transfer row's description at checkout. "Checking…" shows only
 * while the Ogabassey pilot's PiggyVest verdict is unknown (owner decision
 * 2026-11-13); every other merchant gets today's wording or none.
 */
export function walletTransferDescriptionOverride(
  optionEnabled: boolean,
  checking: boolean
): { bank_transfer: string } | undefined {
  if (optionEnabled) return { bank_transfer: WALLET_TRANSFER_DESCRIPTION };
  return checking
    ? { bank_transfer: WALLET_TRANSFER_CHECKING_COPY }
    : undefined;
}
