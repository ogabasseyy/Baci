'use client';

import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { ADMIN_OPERATIONS_MAX_OFFSET } from '@/schemas/admin-operations-query';
import { AdminDataErrorState } from '../admin-data-error-state';
import { EventPipelineOperations } from './event-pipeline-operations';
import { loadOperationsData } from './operations-data';
import { OperationsSummary } from './operations-summary';
import {
  FinancialOperations,
  NotificationOperations,
  QueueState,
  ReadOnlyNotice,
  ShippingOperations,
  WorkerOperations,
} from './operations-tables';
import type { OperationsPageData } from './operations-types';

const INCIDENT_PAGE_SIZE = 25;

export default function OperationsPage() {
  const { toast } = useToast();
  const [data, setData] = useState<OperationsPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);

  const refresh = async (nextOffset = offset) => {
    setLoading(true);
    try {
      setData(await loadOperationsData(nextOffset));
      setOffset(nextOffset);
    } catch {
      console.error('Failed to load admin operations');
      toast({
        title: 'Unable to load operations',
        description: 'No incident data was changed. Refresh to try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: this effect loads once; refresh is intentionally user-triggered thereafter.
  useEffect(() => {
    void refresh();
  }, []);

  const operations = data?.operations.data ?? null;
  const eventPipeline = data?.eventPipeline.data ?? null;
  const hasPotentialOlderOperations = operations
    ? [
        operations.financial.paymentSideEffects,
        operations.financial.payouts,
        operations.financial.reconciliationReview,
        operations.financial.settlements,
        operations.notifications.email,
        operations.notifications.orderOutbox,
        operations.notifications.push,
        operations.notifications.trackingOutbox,
        operations.shipping.shipments,
        operations.shipping.webhooks,
        operations.workers,
      ].some((rows) => rows.length === INCIDENT_PAGE_SIZE)
    : false;
  const hasPotentialOlderPipeline = eventPipeline
    ? Math.max(
        eventPipeline.counts.deliveries,
        eventPipeline.counts.ingress,
        eventPipeline.counts.unknown
      ) >
      offset + INCIDENT_PAGE_SIZE
    : false;
  const hasPotentialOlder =
    hasPotentialOlderOperations || hasPotentialOlderPipeline;
  const reachedIncidentHistoryBoundary = offset >= ADMIN_OPERATIONS_MAX_OFFSET;
  const operationsError = data?.operations.error ? (
    <AdminDataErrorState
      title="Operations data unavailable"
      message={data.operations.error}
      onRetry={() => void refresh()}
      retrying={loading}
    />
  ) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-page-title">Operations</h1>
          <p className="text-muted-foreground">
            Investigate platform incidents, delivery queues, and operational
            health without exposing customer or provider payload data.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw
            className={`mr-2 size-4 ${loading ? 'motion-safe:animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </div>
      {loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 7 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static loading skeletons
            <Skeleton className="h-24" key={index} />
          ))}
        </div>
      ) : null}
      {data ? (
        <>
          {operations ? (
            <OperationsSummary
              canReadFinancials={operations.capabilities.canReadFinancials}
              summary={operations.summary}
            />
          ) : null}
          <ReadOnlyNotice />
          <Tabs defaultValue="pipeline" className="space-y-5">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 md:grid-cols-5">
              <TabsTrigger value="pipeline">Event pipeline</TabsTrigger>
              <TabsTrigger value="financial">Payments</TabsTrigger>
              <TabsTrigger value="notifications">Notifications</TabsTrigger>
              <TabsTrigger value="shipping">Shipping</TabsTrigger>
              <TabsTrigger value="workers">Workers</TabsTrigger>
            </TabsList>
            <TabsContent value="pipeline" className="space-y-4">
              {eventPipeline ? (
                <>
                  <QueueState queue={eventPipeline.operations.queue} />
                  <EventPipelineOperations
                    canReplay={operations?.capabilities.canReplay ?? false}
                    data={eventPipeline}
                    onComplete={() => void refresh()}
                  />
                </>
              ) : (
                <AdminDataErrorState
                  title="Event pipeline unavailable"
                  message={
                    data.eventPipeline.error ??
                    'Event pipeline incidents could not be loaded.'
                  }
                  onRetry={() => void refresh()}
                  retrying={loading}
                />
              )}
            </TabsContent>
            <TabsContent value="financial">
              {operations ? (
                <FinancialOperations
                  canReadFinancials={operations.capabilities.canReadFinancials}
                  data={operations.financial}
                />
              ) : (
                operationsError
              )}
            </TabsContent>
            <TabsContent value="notifications">
              {operations ? (
                <NotificationOperations data={operations.notifications} />
              ) : (
                operationsError
              )}
            </TabsContent>
            <TabsContent value="shipping">
              {operations ? (
                <ShippingOperations data={operations.shipping} />
              ) : (
                operationsError
              )}
            </TabsContent>
            <TabsContent value="workers">
              {operations ? (
                <WorkerOperations workers={operations.workers} />
              ) : (
                operationsError
              )}
            </TabsContent>
          </Tabs>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <div>
              <p>
                Each incident table shows up to {INCIDENT_PAGE_SIZE} rows,
                starting at item {offset + 1}.
              </p>
              {reachedIncidentHistoryBoundary ? (
                <p className="mt-1 text-amber-700 dark:text-amber-300">
                  This view stops at the configured 10,000-row incident history
                  boundary.
                </p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={loading || offset === 0}
                onClick={() =>
                  void refresh(Math.max(0, offset - INCIDENT_PAGE_SIZE))
                }
              >
                Newer incidents
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  loading ||
                  !hasPotentialOlder ||
                  reachedIncidentHistoryBoundary
                }
                onClick={() => void refresh(offset + INCIDENT_PAGE_SIZE)}
              >
                Older incidents
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
