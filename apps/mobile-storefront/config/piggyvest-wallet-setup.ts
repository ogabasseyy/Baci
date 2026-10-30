export const PIGGYVEST_WALLET_SETUP = {
  pollingIntervalMs: 3000,
  pollingWindowMs: 60000,
  readyStaleTimeMs: 30000,
  cacheTimeMs: 300000,
  storagePrefix: 'piggyvest-wallet-setup:v1:',
  rejectedCodes: new Set([
    'INVALID_BVN',
    'INVALID_INPUT',
    'CSRF_INVALID',
    'UNAUTHORIZED',
    'PROFILE_VERIFICATION_REQUIRED',
    'PIGGYVEST_NOT_READY',
    'OWNERSHIP_REVIEW_REQUIRED',
  ]),
};
