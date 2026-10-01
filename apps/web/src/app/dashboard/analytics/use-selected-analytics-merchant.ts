'use client';

import { useEffect, useState } from 'react';
import { fetchDashboardMerchantViaApi } from '@/hooks/merchant/fetch-dashboard-merchant-via-api';
import type { MerchantData, StaffAccess } from '@/hooks/merchant/types';
import { permissionGrantsAccess } from '@/lib/permission-grant';

interface SelectedContext {
  error: string | null;
  merchantId: string;
  merchant: MerchantData | null;
  staffAccess: StaffAccess | null;
}

export function useSelectedAnalyticsMerchant({
  defaultHasPermission,
  defaultMerchant,
  requestedMerchantId,
}: {
  defaultHasPermission: (resource: string, action: string) => boolean;
  defaultMerchant: MerchantData | null;
  requestedMerchantId: string | null;
}) {
  const [selected, setSelected] = useState<SelectedContext | null>(null);
  const needsSelectedContext = Boolean(
    requestedMerchantId && requestedMerchantId !== defaultMerchant?.id
  );

  useEffect(() => {
    if (!requestedMerchantId || !needsSelectedContext) return;
    const controller = new AbortController();
    fetchDashboardMerchantViaApi({
      merchantId: requestedMerchantId,
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) {
          setSelected({
            error: result.merchant
              ? null
              : 'Unable to load the selected merchant. Please try again.',
            merchant: result.merchant,
            merchantId: requestedMerchantId,
            staffAccess: result.staffAccess,
          });
        }
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          setSelected({
            error: 'Unable to load the selected merchant. Please try again.',
            merchant: null,
            merchantId: requestedMerchantId,
            staffAccess: null,
          });
        }
      });
    return () => controller.abort();
  }, [needsSelectedContext, requestedMerchantId]);

  const resolvedSelected =
    needsSelectedContext && selected?.merchantId === requestedMerchantId
      ? selected
      : null;
  const merchant = needsSelectedContext
    ? (resolvedSelected?.merchant ?? null)
    : defaultMerchant;
  const hasPermission = (resource: string, action: string) => {
    if (!needsSelectedContext) return defaultHasPermission(resource, action);
    const access = resolvedSelected?.staffAccess;
    return Boolean(
      access?.isOwner ||
        (access?.isStaff &&
          permissionGrantsAccess(access.permissions, resource, action))
    );
  };

  return {
    error: needsSelectedContext ? (resolvedSelected?.error ?? null) : null,
    hasPermission,
    loading: needsSelectedContext && resolvedSelected === null,
    merchant,
  };
}
