import { PIGGYVEST_SUBACCOUNT_NAME_MAX_CHARACTERS } from './provider-wallet-name.constants';

export const PIGGYVEST_PLAN_WALLET_NAME = {
  maxCharacters: PIGGYVEST_SUBACCOUNT_NAME_MAX_CHARACTERS,
  suffixCharacters: 16,
  legacyHashCharacters: 40,
  label: ' Savings ',
  fallbackCustomer: 'Customer',
} as const;
