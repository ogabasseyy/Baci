import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PiggyvestWalletActivityItem } from '@/schemas/piggyvest-wallet-activity';

/** Test-only: a fresh query client per render, no retries or caching. */
export function ActivityQueryWrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Test-only: one synthetic activity row. */
export function activityItem(
  overrides: Partial<PiggyvestWalletActivityItem> = {}
): PiggyvestWalletActivityItem {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'bank_transfer',
    direction: 'in',
    amountKobo: 5000000,
    feeKobo: 0,
    label: 'Money added',
    status: 'completed',
    occurredAt: '2026-11-13T10:00:00+00:00',
    ...overrides,
  };
}
