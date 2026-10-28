import { vi } from 'vitest';
import type { z } from 'zod';
import type { primaryWalletSavingsReconciliationCheckpointSchemas as checkpointSchemas } from '@/schemas/primary-wallet-savings-reconciliation-checkpoint';
import { savingsIdentityFixture as fixture } from './primary-wallet-savings-identity.test-fixture';

type Checkpoint = {
  state: z.infer<typeof checkpointSchemas.state>;
  save: (state: z.infer<typeof checkpointSchemas.state>) => Promise<boolean>;
};

export function requestInput(
  pages: unknown[] = [fixture.page],
  wallet: unknown = fixture.wallet,
  environment: 'staging' | 'production' = 'production',
  singleTransaction?: unknown
) {
  const remainingPages = [...pages];
  const directTransaction =
    singleTransaction ??
    (environment === 'production'
      ? fixture.productionSingleTransaction
      : fixture.singleTransaction);
  const fetchImplementation = vi
    .fn<typeof fetch>()
    .mockImplementation((input) => {
      const url = new URL(String(input));
      const data = url.pathname.startsWith('/api/v1/wallet/')
        ? wallet
        : /^\/api\/v1\/transaction\/[^/]+$/.test(url.pathname)
          ? directTransaction
          : remainingPages.shift();
      return Promise.resolve(
        new Response(JSON.stringify({ status: true, data }))
      );
    });
  return {
    reservation: fixture.reservation,
    providerResponse: fixture.providerResponse,
    environment,
    token: 'unit-test-token',
    fetchImplementation,
    checkpointScope: {
      integrationId: '00000000-0000-4000-8000-000000000004',
      environment: 'production' as const,
    },
    checkpoint: undefined as Checkpoint | undefined,
  };
}
