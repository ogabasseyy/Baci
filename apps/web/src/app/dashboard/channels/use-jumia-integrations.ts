'use client';

import { useEffect, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  type JumiaDiscoveredShop,
  jumiaDiscoveredShopSchema,
  jumiaSelfAuthorizationDiscoveryResponseSchema,
} from '@/schemas/jumia/self-authorization';
import { buildJumiaApprovalToastMessage } from './jumia-approval-toast';

export interface JumiaIntegration {
  id: string;
  shop_id: string;
  shop_name: string;
  country_code: string;
  marketplace_key?: string;
  is_active: boolean;
  last_sync_at: string | null;
  sync_error: string | null;
}

export type { JumiaDiscoveredShop };

async function fetchJumiaIntegrations(): Promise<{
  integrations: JumiaIntegration[];
  error: string | null;
}> {
  try {
    const response = await fetch('/api/marketplace/jumia/connect');
    if (!response.ok) {
      return {
        integrations: [],
        error: `Failed to load integrations (${response.status})`,
      };
    }
    const data = await response.json();
    return { integrations: data.integrations || [], error: null };
  } catch {
    return {
      integrations: [],
      error: 'Failed to load integrations — please try again',
    };
  }
}

export function useJumiaIntegrations() {
  const [integrations, setIntegrations] = useState<JumiaIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchJumiaIntegrations().then((result) => {
      if (cancelled) return;
      setIntegrations(result.integrations);
      setError(result.error);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const refetch = async (): Promise<JumiaIntegration[]> => {
    setLoading(true);
    setError(null);
    const result = await fetchJumiaIntegrations();
    setIntegrations(result.integrations);
    setError(result.error);
    setLoading(false);
    return result.integrations;
  };

  return { integrations, setIntegrations, loading, error, refetch };
}

export async function discoverJumiaShops(
  clientId: string,
  refreshToken: string,
  discoveryId?: string
): Promise<{
  ok: boolean;
  shops?: JumiaDiscoveredShop[];
  discoveryId?: string;
  retryable?: boolean;
  error?: string;
}> {
  try {
    const response = await fetchWithCsrf('/api/marketplace/jumia/connect', {
      method: 'POST',
      body: JSON.stringify({
        connectionType: 'self_authorization',
        operation: 'discover',
        clientId: clientId.trim(),
        refreshToken: refreshToken.trim() || undefined,
        discoveryId,
      }),
    });

    const data: unknown = await response.json();
    if (!response.ok) {
      const errorBody =
        typeof data === 'object' &&
        data !== null &&
        'error' in data &&
        typeof data.error === 'string'
          ? data.error
          : 'Shop discovery failed';
      const discoveryId =
        typeof data === 'object' &&
        data !== null &&
        'discoveryId' in data &&
        typeof data.discoveryId === 'string'
          ? data.discoveryId
          : undefined;
      return {
        ok: false,
        error: errorBody,
        ...(discoveryId ? { discoveryId } : {}),
        ...(typeof data === 'object' &&
        data !== null &&
        'retryable' in data &&
        data.retryable === true
          ? { retryable: true }
          : {}),
      };
    }

    const parsed =
      jumiaSelfAuthorizationDiscoveryResponseSchema.safeParse(data);
    if (!parsed.success) {
      return { ok: false, error: 'Shop discovery failed' };
    }

    return {
      ok: true,
      shops: parsed.data.shops,
      discoveryId: parsed.data.discoveryId,
    };
  } catch {
    return {
      ok: false,
      error: 'Shop discovery failed — please try again',
    };
  }
}

export async function connectJumiaShops(
  clientId: string,
  discoveryId: string,
  selectedShopIds: string[]
): Promise<{
  ok: boolean;
  error?: string;
  discoveryComplete?: boolean;
  discoveryId?: string;
  retryable?: boolean;
}> {
  try {
    const response = await fetchWithCsrf('/api/marketplace/jumia/connect', {
      method: 'POST',
      body: JSON.stringify({
        connectionType: 'self_authorization',
        clientId: clientId.trim(),
        discoveryId,
        selectedShopIds,
      }),
    });

    const data: unknown = await response.json();
    if (!response.ok) {
      const errorBody =
        typeof data === 'object' &&
        data !== null &&
        'error' in data &&
        typeof data.error === 'string'
          ? data.error
          : 'Connection failed';
      const recoveryDiscoveryId =
        response.headers.get('x-jumia-discovery-id') ?? undefined;
      return {
        ok: false,
        error: errorBody,
        ...(recoveryDiscoveryId && {
          discoveryId: recoveryDiscoveryId,
          retryable: true,
        }),
      };
    }
    const recoveryDiscoveryId =
      response.headers.get('x-jumia-discovery-id') ?? undefined;
    return {
      ok: true,
      discoveryComplete:
        response.headers.get('x-jumia-discovery-complete') !== 'false',
      ...(recoveryDiscoveryId && { discoveryId: recoveryDiscoveryId }),
    };
  } catch {
    return { ok: false, error: 'Connection failed — please try again' };
  }
}

export async function disconnectIntegration(
  integrationId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetchWithCsrf(
      `/api/marketplace/jumia/connect?id=${encodeURIComponent(integrationId)}`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      return { ok: false, error: 'Failed to disconnect' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Failed to disconnect' };
  }
}

export async function syncOrders(
  integrationId: string
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const response = await fetchWithCsrf(
      `/api/marketplace/jumia/orders?integrationId=${encodeURIComponent(integrationId)}`,
      { method: 'POST' }
    );
    const data = await response.json();
    if (!response.ok) {
      const detail = data.details
        ? `${data.error || 'Sync failed'}\nDetails: ${data.details}`
        : data.error || 'Sync failed';
      return { ok: false, error: detail };
    }
    return {
      ok: true,
      message: `Synced ${data.synced} orders (${data.newOrders} new)`,
    };
  } catch {
    return { ok: false, error: 'Sync failed — please try again' };
  }
}

export async function syncStock(
  integrationId: string
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const response = await fetchWithCsrf(
      `/api/marketplace/jumia/products/stock?integrationId=${encodeURIComponent(integrationId)}`,
      { method: 'POST' }
    );
    const data = await response.json();
    if (!response.ok) {
      const detail = data.details
        ? `${data.error || 'Stock sync failed'}\nDetails: ${data.details}`
        : data.error || 'Stock sync failed';
      return { ok: false, error: detail };
    }
    // The route reports logical failures (nothing pushed) as HTTP 200 with
    // `success: false`; surfacing those as success would toast a lie.
    if (data.success === false) {
      return { ok: false, error: data.message || 'Stock sync failed' };
    }
    return { ok: true, message: data.message || 'Stock synced' };
  } catch {
    return { ok: false, error: 'Stock sync failed — please try again' };
  }
}

export async function checkProductApprovals(
  integrationId: string
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const response = await fetchWithCsrf(
      `/api/marketplace/jumia/products/feed-status?integrationId=${encodeURIComponent(integrationId)}`,
      { method: 'POST' }
    );
    const data = await response.json();
    if (!response.ok) {
      return {
        ok: false,
        error: data.error || 'Could not check product approvals',
      };
    }
    return {
      ok: true,
      message: buildJumiaApprovalToastMessage(data),
    };
  } catch {
    return {
      ok: false,
      error: 'Could not check product approvals — please try again',
    };
  }
}

// Re-export for tests that assert shop shape validation.
export { jumiaDiscoveredShopSchema };
