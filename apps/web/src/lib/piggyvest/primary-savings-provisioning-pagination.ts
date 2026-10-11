import 'server-only';
import type { z } from 'zod';
import { primarySavingsProvisioningPaginationSchemas as schemas } from '@/schemas/primary-savings-provisioning-pagination';
import { type PiggyvestClientConfig, piggyvestRequest } from './client';
import { primarySavingsProvisioningPaginationLimits as limits } from './primary-savings-provisioning-pagination.constants';

export async function listPrimarySavingsProvisioningWallets(
  config: PiggyvestClientConfig,
  input: z.input<typeof schemas.input>
) {
  const { customerId, walletName } = schemas.input.parse(input);
  const deadline = performance.now() + limits.timeBudgetMs;
  const cursors = new Set<string>();
  const walletIds = new Set<string>();
  const matches: z.infer<typeof schemas.page>['paginatedPayload']['edges'] = [];
  let cursor: string | undefined;
  try {
    for (let pageNumber = 0; pageNumber < limits.maxPages; pageNumber++) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) return [];
      let timer: ReturnType<typeof setTimeout> | undefined;
      const page = await Promise.race([
        piggyvestRequest(
          config,
          schemas.page,
          '/api/v1/wallet/api/wallet-type',
          {
            method: 'GET',
            query: {
              customer_id: customerId,
              limit: String(limits.pageSize),
              orderBy: 'ASC',
              cursor,
            },
          }
        ),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Wallet listing incomplete')),
            remaining
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (performance.now() >= deadline) return [];
      const { edges, pageInfo } = page.paginatedPayload;
      if (pageInfo.endCursor && cursors.has(pageInfo.endCursor)) return [];
      if (pageInfo.endCursor) cursors.add(pageInfo.endCursor);
      if (edges.length === 0 && (pageInfo.hasNextPage || pageNumber > 0))
        return [];
      for (const wallet of edges) {
        if (walletIds.has(wallet.id)) return [];
        walletIds.add(wallet.id);
        if (wallet.name === walletName && matches.length < 2)
          matches.push(wallet);
      }
      if (!pageInfo.hasNextPage) return matches;
      cursor = pageInfo.endCursor ?? undefined;
    }
  } catch {
    return [];
  }
  return [];
}
