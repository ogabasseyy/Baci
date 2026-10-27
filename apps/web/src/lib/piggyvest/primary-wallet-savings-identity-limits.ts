export const primaryWalletSavingsIdentityLimits = {
  maxPages: 50,
  pageSize: 100,
  timeBudgetMs: 20_000,
  requestTimeoutMs: 10_000,
  walletResponseBytes: 65_536,
  transactionResponseBytes: 65_536,
  pageResponseBytes: 1_048_576,
} as const;
