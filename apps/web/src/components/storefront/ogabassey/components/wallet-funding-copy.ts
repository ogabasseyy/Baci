/**
 * Copy for the wallet bank-transfer (Paystack DVA) funding surfaces.
 * The fee note reflects Paystack's dedicated-virtual-account pricing:
 * 1% per inbound transfer, capped at ₦300 — versus 1.5% + ₦100 (capped
 * ₦2,000) on card/hosted checkout rails.
 */
export const WALLET_FUNDING_COPY = {
  consentBlurb:
    'We create a dedicated bank account number just for you. Any transfer you send to it lands in your wallet automatically.',
  consentCta: 'Get my account number',
  copied: 'Account number copied',
  copyCta: 'Copy',
  creating: 'Setting up your account number...',
  feeNote: 'Bank transfers cost just 1% (capped at ₦300) — cheaper than card fees.',
  fundCta: 'Pay with Bank Transfer',
  fundCtaSubtitle: 'Transfer to your wallet account number — 1% fee, max ₦300',
  invalidPhone:
    'Please enter a valid Nigerian phone number (e.g., 08012345678)',
  invalidName: 'Please enter both your first and last name',
  nameSaveFailed: 'Could not save your name. Please try again.',
  orderPaymentInProgress:
    'Your account number is handling an order payment right now. Complete that payment first, then try again — reservations clear within about 90 minutes.',
  refreshCta: "I've sent it — refresh balance",
  // Check-loop copy. `checkTimedOut` must never imply the money arrived — a
  // timeout only means we have not SEEN it yet.
  checkAgainCta: 'Check again',
  checkChecking: 'Checking for your transfer...',
  checkCheckingHint:
    'Transfers usually land in under a minute. Keep this page open — we are watching for it.',
  // Never claims a BANK transfer specifically landed: a new card top-up shares
  // the same `wallet_topup` ledger marker (see `wallet-funding-credit-detection`),
  // so the copy only affirms the wallet was funded — which is true either way.
  checkCredited: 'Your wallet has been topped up.',
  checkStartCta: "I've transferred — check for it",
  checkTimedOut:
    "We haven't seen your transfer yet. Bank transfers can take a few minutes — check again in a moment.",
  returnToPurchaseCta: 'Return to your purchase',
  returnUpdatingBalance: 'Updating your balance...',
  // Recovery when the post-credit balance refresh fails and the return CTA
  // stays gated: let the customer re-trigger the refresh instead of reloading.
  returnRefreshRetry: 'Refresh balance',
  subtitle:
    'Transfer to your personal account number below and your wallet is credited automatically.',
  title: 'Fund by bank transfer',
  unavailable:
    'Bank transfer funding is not available right now. Please try again later.',
  walletRecommendedBadge: 'Recommended',
  phoneSaveFailed: 'Could not save your phone number. Please try again.',
  zeroBalanceHint: 'Fund your wallet to pay without card fees',
} as const;
