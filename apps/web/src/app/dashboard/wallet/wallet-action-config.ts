export const walletActionConfig = {
  maxTransactionLimit: 100,
  minimumWithdrawalAmount: 1000,
  validPayoutDays: [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ],
} as const;
