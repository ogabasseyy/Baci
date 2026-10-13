import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { JumiaOrder, MarketplaceIntegration } from './types.ts';

export interface JumiaOrdersConfig {
  apiBase: string;
  maxPages: number;
}

export async function fetchAllJumiaOrders(
  _supabase: SupabaseClient,
  integration: MarketplaceIntegration,
  accessToken: string,
  updatedAfter: string,
  updatedBefore: string,
  config: JumiaOrdersConfig,
  refreshToken: () => Promise<string>
): Promise<JumiaOrder[]> {
  const allOrders: JumiaOrder[] = [];
  let nextToken: string | null = null;
  let pageCount = 0;
  let currentToken = accessToken;

  do {
    pageCount++;
    if (pageCount > config.maxPages) {
      throw new Error(
        `Reached max page limit (${config.maxPages}) — too many orders to sync in one run. ` +
          'Aborting without advancing last_sync_at so the next run retries.'
      );
    }

    if (pageCount > 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const params = new URLSearchParams({
      updatedAfter,
      updatedBefore,
    });
    if (nextToken) params.set('nextToken', nextToken);

    let response = await fetch(`${config.apiBase}/orders?${params}`, {
      headers: {
        Authorization: `Bearer ${currentToken}`,
        Accept: 'application/json',
      },
    });

    if (response.status === 401) {
      console.log(
        `[Jumia Sync] Token expired for integration ${integration.id}, refreshing and retrying`
      );
      currentToken = await refreshToken();
      response = await fetch(`${config.apiBase}/orders?${params}`, {
        headers: {
          Authorization: `Bearer ${currentToken}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '<unreadable body>');
        throw new Error(
          `Jumia API error after token refresh: ${response.status} - ${body}`
        );
      }
    } else if (!response.ok) {
      const body = await response.text().catch(() => '<unreadable body>');
      throw new Error(`Jumia API error: ${response.status} - ${body}`);
    }

    const data = await response.json();
    const orders: JumiaOrder[] = data.orders || [];
    allOrders.push(...orders);

    nextToken = data.nextToken ?? null;
    if (data.isLastPage) break;
  } while (nextToken);

  return allOrders;
}
