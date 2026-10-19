export const authority = Object.freeze({
  repository: '/Users/mac/Baci-worktrees/cursor-savings-phase1',
  provider: 'apps/web/src/lib/piggyvest/prefunded-card-checkout-provider.ts',
  providerSha256:
    '6acb4d8a5b69984224bf7754c97bcefa93c38cf78b6f5ea0c014d561c0ed22e8',
  deadline: '2026-10-06T15:59:10Z',
  financialSealSha256:
    'c78ef2d125ad8019508cfced9e19d730848184c528b7a33c68d42c782418b086',
  publicArchiveSha256:
    '882f0fd9d436a8117a48df1ae45bb4dba95d43da2c28b3a7f1d7c7e379cea1b2',
  publicManifestSha256:
    '42b5f4e5f457ccea7fa1b61192251b60e0b8f01b05858fc2220b1944b5de62d8',
  launcherSha256:
    'd0d0a249a940f9783cc2d8784868ca776c65f2e060ca4095736e4fea70b61f03',
  publicSourceManifestSha256:
    '4b066d0e957b4f029c1be1e5c71c1496e269600d1763414645882d832c5c07d7',
});

export const entrypoints = Object.freeze({
  publicCheckout:
    'apps/web/src/app/api/storefront/customer/savings/card-checkout/route.ts',
  background: 'apps/web/src/scripts/run-prefunded-card-background.ts',
  recoveryCli: 'apps/web/src/scripts/run-prefunded-card-checkout-recovery.ts',
  ownerPaymentProof:
    'tools/staging/prefunded-card/owner-payment-proof/collect.ts',
});
