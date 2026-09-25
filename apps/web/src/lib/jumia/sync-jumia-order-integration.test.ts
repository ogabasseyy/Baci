import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JumiaClient } from '@/lib/jumia/client';
import { getAllOrders, getOrderItems } from '@/lib/jumia/orders';

const mocks = vi.hoisted(() => ({
  forIntegration: vi.fn(),
}));

vi.mock('@/lib/jumia/client', () => ({
  JumiaClient: {
    forIntegration: mocks.forIntegration,
  },
}));

vi.mock('@/lib/jumia/orders', () => ({
  getAllOrders: vi.fn(),
  getOrderItems: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('./order-sync-operations', () => ({
  buildExistingJumiaCacheEntry: vi.fn(),
  buildSyncedJumiaCacheRow: vi.fn(),
  loadExistingCanonicalOrders: vi.fn(),
  loadExistingJumiaOrders: vi.fn(),
  notifySyncedJumiaOrder: vi.fn(),
  upsertCanonicalOrder: vi.fn(),
}));

import {
  buildExistingJumiaCacheEntry,
  buildSyncedJumiaCacheRow,
  loadExistingCanonicalOrders,
  loadExistingJumiaOrders,
  notifySyncedJumiaOrder,
  upsertCanonicalOrder,
} from './order-sync-operations';
import {
  type SyncJumiaOrderIntegrationDependencies,
  syncJumiaOrderIntegration,
} from './sync-jumia-order-integration';

const dependencies = {
  createClient: (supabase, merchantId, integrationId) =>
    mocks.forIntegration(
      supabase,
      merchantId,
      integrationId
    ) as Promise<JumiaClient>,
  getAllOrders,
  getOrderItems,
  buildExistingJumiaCacheEntry,
  buildSyncedJumiaCacheRow,
  loadExistingCanonicalOrders,
  loadExistingJumiaOrders,
  notifySyncedJumiaOrder,
  upsertCanonicalOrder,
} satisfies SyncJumiaOrderIntegrationDependencies;

const result = {
  integrations: 1,
  synced: 0,
  canonicalCreated: 0,
  canonicalUpdated: 0,
  notified: 0,
  stockUpdated: 0,
  orderErrors: 0,
  errors: [],
};

const integration = {
  id: 'integration-1',
  merchant_id: 'merchant-1',
  shop_id: 'shop-1',
  last_sync_at: null,
  sync_config: { orders: true },
};

describe('syncJumiaOrderIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips disabled order synchronization without loading credentials', async () => {
    const disabledIntegration = {
      ...integration,
      sync_config: { orders: false },
    };

    await expect(
      syncJumiaOrderIntegration(
        {} as SupabaseClient,
        disabledIntegration,
        result,
        dependencies
      )
    ).resolves.toBeUndefined();

    expect(mocks.forIntegration).not.toHaveBeenCalled();
  });

  it('propagates provider listing failures to the integration caller', async () => {
    mocks.forIntegration.mockResolvedValue({ client: true });
    vi.mocked(getAllOrders).mockRejectedValueOnce(
      new Error('provider unavailable')
    );

    await expect(
      syncJumiaOrderIntegration(
        {} as SupabaseClient,
        integration,
        structuredClone(result),
        dependencies
      )
    ).rejects.toThrow('provider unavailable');
  });
});
