// Shared values remain the single oracle (see
// packages/shared/src/constants/wallet-top-up.ts); this module
// re-exports them for the web server's existing import path.
export {
  WALLET_TOP_UP_MAX_AMOUNT,
  WALLET_TOP_UP_MIN_AMOUNT,
} from '@baci/shared/constants';
