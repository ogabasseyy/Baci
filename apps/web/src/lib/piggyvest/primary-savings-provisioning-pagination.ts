import 'server-only';
import type { z } from 'zod';
import { primarySavingsProvisioningPaginationSchemas as schemas } from '@/schemas/primary-savings-provisioning-pagination';
import { type PiggyvestClientConfig, piggyvestRequest } from './client';
import { primarySavingsProvisioningPaginationLimits as limits } from './primary-savings-provisioning-pagination.constants';
import { matchesProviderWalletName } from './provider-wallet-name';

/**
 * Lists the customer's wallets whose name matches the goal wallet name.
 * Returns the matches (at most two, so callers can refuse ambiguity) only
 * for a complete listing; `[]` therefore proves no such wallet exists.
 * Any listing that could not be completed (failure, time budget, cursor
 * loop, duplicate ids, an empty later page, the page cap) returns `null`:
 * absence is unknown, never assumed.
 */
export async function listPrimarySavingsProvisioningWallets(
  config: PiggyvestClientConfig,
  input: z.input<typeof schemas.input>
): Promise<z.infer<typeof schemas.page>['paginatedPayload']['edges'] | null> {
  const { customerId, walletName } = schemas.input.parse(input);
  const deadline = performance.now() + limits.timeBudgetMs;
  const cursors = new Set<string>();
  const walletIds = new Set<string>();
  const matches: z.infer<typeof schemas.page>['paginatedPayload']['edges'] = [];
  let cursor: string | undefined;
  try {
    for (let pageNumber = 0; pageNumber < limits.maxPages; pageNumber++) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) return null;
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
      if (performance.now() >= deadline) return null;
      const { edges, pageInfo } = page.paginatedPayload;
      if (pageInfo.endCursor && cursors.has(pageInfo.endCursor)) return null;
      if (pageInfo.endCursor) cursors.add(pageInfo.endCursor);
      if (edges.length === 0 && (pageInfo.hasNextPage || pageNumber > 0))
        return null;
      for (const wallet of edges) {
        if (walletIds.has(wallet.id)) return null;
        walletIds.add(wallet.id);
        if (
          matchesProviderWalletName(wallet.name, walletName) &&
          matches.length < 2
        )
          matches.push(wallet);
      }
      if (!pageInfo.hasNextPage) return matches;
      cursor = pageInfo.endCursor ?? undefined;
    }
  } catch {
    return null;
  }
  return null;
}
