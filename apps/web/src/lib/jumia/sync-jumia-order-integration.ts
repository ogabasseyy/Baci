import type { SupabaseClient } from '@supabase/supabase-js';
import type { JumiaClient } from '@/lib/jumia/client';
import { getJumiaOrderQueryFilters } from '@/lib/jumia/order-query-filters';
import type { JumiaOrderSyncResult } from '@/lib/jumia/order-sync-result';
import type { getAllOrders, getOrderItems } from '@/lib/jumia/orders';
import { logger } from '@/lib/logger';
import {
  formatJumiaOrderTimestamp,
  getJumiaSyncLowerBound,
  type MarketplaceIntegrationRow,
  readOrderSyncEnabled,
} from './order-sync-mappers';
import {
  getJumiaNotificationAttemptKey,
  sendJumiaOrderNotification,
} from './order-sync-notifications';
import type {
  buildExistingJumiaCacheEntry,
  buildSyncedJumiaCacheRow,
  loadExistingCanonicalOrders,
  loadExistingJumiaOrders,
  notifySyncedJumiaOrder,
  upsertCanonicalOrder,
} from './order-sync-operations';
import {
  clearFullFailureState,
  readFullFailureState,
  withFullFailureState,
} from './order-sync-state';

const INITIAL_SYNC_CURSOR = 'initial-sync';

export type SyncUpdatePayload = Partial<{ last_sync_at: string }> & {
  sync_config: Record<string, unknown>;
  sync_error: string | null;
};

export type SyncJumiaOrderIntegrationDependencies = Readonly<{
  createClient: (
    supabase: SupabaseClient,
    merchantId: string,
    integrationId: string
  ) => Promise<JumiaClient>;
  getAllOrders: typeof getAllOrders;
  getOrderItems: typeof getOrderItems;
  buildExistingJumiaCacheEntry: typeof buildExistingJumiaCacheEntry;
  buildSyncedJumiaCacheRow: typeof buildSyncedJumiaCacheRow;
  loadExistingCanonicalOrders: typeof loadExistingCanonicalOrders;
  loadExistingJumiaOrders: typeof loadExistingJumiaOrders;
  notifySyncedJumiaOrder: typeof notifySyncedJumiaOrder;
  upsertCanonicalOrder: typeof upsertCanonicalOrder;
}>;

export class JumiaSyncCursorUpdateError extends Error {
  constructor(
    message: string,
    readonly syncUpdate: SyncUpdatePayload
  ) {
    super(message);
    this.name = 'JumiaSyncCursorUpdateError';
    Object.setPrototypeOf(this, JumiaSyncCursorUpdateError.prototype);
  }
}

export async function syncJumiaOrderIntegration(
  supabase: SupabaseClient,
  integration: MarketplaceIntegrationRow,
  result: JumiaOrderSyncResult,
  dependencies: SyncJumiaOrderIntegrationDependencies
) {
  if (!readOrderSyncEnabled(integration.sync_config)) return;

  const client = await dependencies.createClient(
    supabase,
    integration.merchant_id,
    integration.id
  );
  const orderErrorsBefore = result.orderErrors;
  let syncedAnyOrder = false;
  let earliestFailedSyncAt: string | null = null;
  let earliestFailedSyncMs: number | null = null;
  const attemptedNotificationKeys = new Set<string>();
  const syncStartedAt = formatJumiaOrderTimestamp(new Date());
  const syncLowerBound = getJumiaSyncLowerBound(integration.last_sync_at);
  const orders = await dependencies.getAllOrders(client, {
    updatedAfter: syncLowerBound,
    updatedBefore: syncStartedAt,
    size: 100,
    ...getJumiaOrderQueryFilters({
      shopId: integration.shop_id ?? 'oauth',
      countryCode: integration.country_code,
      marketplaceKey: integration.marketplace_key,
    }),
  });

  const existingJumiaOrders = await dependencies.loadExistingJumiaOrders(
    supabase,
    integration.merchant_id,
    orders.map((order) => order.id)
  );
  const canonicalOrders = await dependencies.loadExistingCanonicalOrders(
    supabase,
    integration.merchant_id,
    orders.map((order) => order.id)
  );

  for (const order of orders) {
    try {
      const existingJumia = existingJumiaOrders.get(order.id);
      const existingCanonical = canonicalOrders.get(order.id);
      const notificationKey = getJumiaNotificationAttemptKey(
        integration.merchant_id,
        order.id
      );
      const shouldNotify =
        // Legacy cache rows without a durable sent marker are intentionally
        // retried. The per-run key and in-memory marker prevent duplicated
        // Jumia API pages from sending duplicate pushes in the same run.
        existingJumia?.notification_sent !== true &&
        !attemptedNotificationKeys.has(notificationKey);
      const items = (await dependencies.getOrderItems(client, order.id)).items;

      const canonicalOrder = await dependencies.upsertCanonicalOrder(
        supabase,
        integration,
        order,
        items,
        existingCanonical
      );
      canonicalOrders.set(order.id, canonicalOrder);

      const cacheRow = dependencies.buildSyncedJumiaCacheRow(
        integration,
        order,
        items,
        existingJumia,
        canonicalOrder.id
      );
      const { error: cacheError } = await supabase
        .from('jumia_orders')
        .upsert(cacheRow, { onConflict: 'jumia_order_id' });
      if (cacheError) {
        throw new Error(`Failed to cache Jumia order: ${cacheError.message}`);
      }
      existingJumiaOrders.set(
        order.id,
        dependencies.buildExistingJumiaCacheEntry(
          order.id,
          cacheRow.notification_sent,
          canonicalOrder.id
        )
      );

      if (existingCanonical) result.canonicalUpdated += 1;
      else result.canonicalCreated += 1;

      if (shouldNotify) {
        await sendJumiaOrderNotification(supabase, {
          merchantId: integration.merchant_id,
          integrationId: integration.id,
          order,
          canonicalOrderId: canonicalOrder.id,
          notificationKey,
          attemptedNotificationKeys,
          existingJumiaOrders,
          notifySyncedJumiaOrder: dependencies.notifySyncedJumiaOrder,
          buildExistingJumiaCacheEntry:
            dependencies.buildExistingJumiaCacheEntry,
          onNotified: () => {
            result.notified += 1;
          },
        });
      }

      result.synced += 1;
      syncedAnyOrder = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const parsedFailedUpdatedAt = Date.parse(order.updatedAt);
      const failedSyncMs = Number.isFinite(parsedFailedUpdatedAt)
        ? parsedFailedUpdatedAt
        : Date.parse(syncStartedAt);
      const failedSyncAt = new Date(failedSyncMs).toISOString();
      if (
        earliestFailedSyncMs === null ||
        failedSyncMs < earliestFailedSyncMs
      ) {
        earliestFailedSyncAt = failedSyncAt;
        earliestFailedSyncMs = failedSyncMs;
      }
      result.orderErrors += 1;
      result.errors.push(`${integration.merchant_id}/${order.id}: ${message}`);
      logger.error({
        message: 'Failed to process Jumia order during sync',
        merchantId: integration.merchant_id,
        integrationId: integration.id,
        jumiaOrderId: order.id,
        error,
      });
    }
  }

  const integrationOrderErrors = result.orderErrors - orderErrorsBefore;
  let syncUpdate: SyncUpdatePayload;
  if (integrationOrderErrors === 0) {
    syncUpdate = {
      last_sync_at: syncStartedAt,
      sync_error: null,
      sync_config: clearFullFailureState(integration.sync_config),
    };
  } else if (syncedAnyOrder) {
    syncUpdate = {
      last_sync_at: earliestFailedSyncAt ?? syncStartedAt,
      sync_error: `Processed with ${integrationOrderErrors} Jumia order error(s); cursor parked at earliest failed order ${earliestFailedSyncAt ?? syncStartedAt} so failed orders remain retryable`,
      sync_config: clearFullFailureState(integration.sync_config),
    };
  } else {
    // Every order failed: never advance past unpersisted orders. The
    // provider listing paginates the full window, so parking cannot starve
    // newer orders; advancing would permanently drop failed orders older
    // than the overlap window.
    const failureCursor = integration.last_sync_at ?? INITIAL_SYNC_CURSOR;
    const previousFailureState = readFullFailureState(integration.sync_config);
    const fullFailureCount =
      previousFailureState?.cursor === failureCursor
        ? previousFailureState.count + 1
        : 1;
    syncUpdate = {
      // A never-synced integration has no cursor yet: persist this run's
      // lower bound so failures stay retryable. Recomputing a moving
      // seven-day lookback on every run would let an order that stays
      // unprocessable for seven days fall out of the query window.
      ...(integration.last_sync_at ? {} : { last_sync_at: syncLowerBound }),
      sync_error: `All ${integrationOrderErrors} Jumia order(s) failed; cursor not advanced (consecutive full failure ${fullFailureCount} at ${failureCursor}) so failed orders remain retryable`,
      sync_config: withFullFailureState(
        integration.sync_config,
        failureCursor,
        fullFailureCount
      ),
    };
  }

  const { error: syncError } = await supabase
    .from('marketplace_integrations')
    .update(syncUpdate)
    .eq('id', integration.id);
  if (syncError) {
    throw new JumiaSyncCursorUpdateError(
      `Failed to update Jumia sync cursor: ${syncError.message}`,
      syncUpdate
    );
  }
}
