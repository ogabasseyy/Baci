'use client';

import { useState } from 'react';
import type { useToast } from '@/hooks/use-toast';
import {
  checkProductApprovals,
  syncOrders,
  syncStock,
} from './use-jumia-integrations';

type UseJumiaChannelActionsArgs = {
  refetch: () => Promise<unknown>;
  toast: ReturnType<typeof useToast>['toast'];
};

export function useJumiaChannelActions({
  refetch,
  toast,
}: UseJumiaChannelActionsArgs) {
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [stockSyncingIds, setStockSyncingIds] = useState<Set<string>>(
    new Set()
  );
  const [approvalCheckingIds, setApprovalCheckingIds] = useState<Set<string>>(
    new Set()
  );
  const [publishIntegrationId, setPublishIntegrationId] = useState<
    string | null
  >(null);

  const handleSync = async (integrationId: string) => {
    setSyncingIds((prev) => new Set(prev).add(integrationId));
    const result = await syncOrders(integrationId);

    if (result.ok) {
      toast({ title: result.message });
      void refetch();
    } else {
      toast({
        title: 'Sync failed',
        description: result.error,
        variant: 'destructive',
      });
    }

    setSyncingIds((prev) => {
      const next = new Set(prev);
      next.delete(integrationId);
      return next;
    });
  };

  const handleStockSync = async (integrationId: string) => {
    setStockSyncingIds((prev) => new Set(prev).add(integrationId));
    const result = await syncStock(integrationId);

    if (result.ok) {
      toast({ title: result.message });
      void refetch();
    } else {
      toast({
        title: 'Stock sync failed',
        description: result.error,
        variant: 'destructive',
      });
    }

    setStockSyncingIds((prev) => {
      const next = new Set(prev);
      next.delete(integrationId);
      return next;
    });
  };

  const handleCheckApprovals = async (integrationId: string) => {
    setApprovalCheckingIds((prev) => new Set(prev).add(integrationId));
    const result = await checkProductApprovals(integrationId);
    if (result.ok) {
      toast({ title: result.message });
      void refetch();
    } else {
      toast({
        title: 'Approval check failed',
        description: result.error,
        variant: 'destructive',
      });
    }
    setApprovalCheckingIds((prev) => {
      const next = new Set(prev);
      next.delete(integrationId);
      return next;
    });
  };

  return {
    syncingIds,
    stockSyncingIds,
    approvalCheckingIds,
    publishIntegrationId,
    setPublishIntegrationId,
    handleSync,
    handleStockSync,
    handleCheckApprovals,
  };
}
