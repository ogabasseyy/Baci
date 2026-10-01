import { AlertTriangle, CheckCircle2, Clock3, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { AdminOperations } from '@/schemas/admin-operations-rpc';
import { OperationsIncidentTable } from './operations-incident-table';
import type { EventPipelineData } from './operations-types';
import { settlementExceptionFormatters } from './settlement-exception-formatters';

function formatOperationDate(value: unknown) {
  if (typeof value !== 'string') return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}
function formatOperationTitle(value: unknown) {
  const text = typeof value === 'string' && value.trim() ? value : '—';
  return text.replaceAll('_', ' ');
}

function renderOperationStateBadge(value: unknown) {
  const state = formatOperationTitle(value).toLowerCase();
  return (
    <Badge
      variant={state === 'healthy' ? 'outline' : 'destructive'}
      className="capitalize"
    >
      {state}
    </Badge>
  );
}
export function FinancialOperations({
  canReadFinancials,
  data,
}: {
  canReadFinancials: boolean;
  data: AdminOperations['financial'];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <OperationsIncidentTable
        title="Unresolved reconciliation review"
        empty="No unresolved reconciliation items."
        rows={data.reconciliationReview}
        columns={[
          { key: 'merchantName', label: 'Merchant' },
          { key: 'issueType', label: 'Issue', render: formatOperationTitle },
          { key: 'createdAt', label: 'Created', render: formatOperationDate },
        ]}
      />
      <OperationsIncidentTable
        title="Failed or stale payment side effects"
        empty="No payment side effects need review."
        rows={data.paymentSideEffects}
        columns={[
          { key: 'merchantName', label: 'Merchant' },
          { key: 'step', label: 'Step', render: formatOperationTitle },
          { key: 'attempts', label: 'Attempts' },
          {
            key: 'status',
            label: 'State',
            render: renderOperationStateBadge,
          },
        ]}
      />
      {canReadFinancials ? (
        <>
          <OperationsIncidentTable
            title="Settlement exceptions"
            empty="No overdue or failed settlements."
            rows={data.settlements}
            columns={[
              { key: 'merchantName', label: 'Merchant' },
              { key: 'gateway', label: 'Gateway' },
              {
                key: 'netAmount',
                label: 'Net amount',
                render: settlementExceptionFormatters.settlementMoney,
              },
              {
                key: 'currency',
                label: 'Currency',
                render: settlementExceptionFormatters.currency,
              },
              {
                key: 'status',
                label: 'State',
                render: renderOperationStateBadge,
              },
            ]}
          />
          <OperationsIncidentTable
            title="Payout exceptions"
            empty="No failed or stale payouts."
            rows={data.payouts}
            columns={[
              { key: 'merchantName', label: 'Merchant' },
              {
                key: 'amount',
                label: 'Amount',
                render: settlementExceptionFormatters.genericMoney,
              },
              { key: 'currency', label: 'Currency' },
              {
                key: 'payoutMode',
                label: 'Mode',
                render: formatOperationTitle,
              },
              {
                key: 'status',
                label: 'State',
                render: renderOperationStateBadge,
              },
            ]}
          />
        </>
      ) : null}
    </div>
  );
}
export function NotificationOperations({
  data,
}: {
  data: AdminOperations['notifications'];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <OperationsIncidentTable
        title="Failed or stale email attempts"
        empty="No failed or stale email attempts."
        rows={data.email}
        columns={[
          { key: 'merchantName', label: 'Merchant' },
          { key: 'emailType', label: 'Type', render: formatOperationTitle },
          { key: 'providerErrorCode', label: 'Safe error code' },
          {
            key: 'status',
            label: 'State',
            render: renderOperationStateBadge,
          },
          { key: 'createdAt', label: 'Created', render: formatOperationDate },
        ]}
      />
      <OperationsIncidentTable
        title="Failed push attempts"
        empty="No failed push attempts."
        rows={data.push}
        columns={[
          { key: 'merchantName', label: 'Merchant' },
          { key: 'appType', label: 'App', render: formatOperationTitle },
          { key: 'failedCount', label: 'Failures' },
          {
            key: 'status',
            label: 'State',
            render: renderOperationStateBadge,
          },
        ]}
      />
      <OperationsIncidentTable
        title="Fulfilment notification outbox"
        empty="No failed or stale order notifications."
        rows={data.orderOutbox}
        columns={[
          { key: 'merchantName', label: 'Merchant' },
          { key: 'eventType', label: 'Event', render: formatOperationTitle },
          { key: 'attemptCount', label: 'Attempts' },
          {
            key: 'status',
            label: 'State',
            render: renderOperationStateBadge,
          },
        ]}
      />
      <OperationsIncidentTable
        title="Tracking notification outbox"
        empty="No failed or stale tracking notifications."
        rows={data.trackingOutbox}
        columns={[
          { key: 'merchantName', label: 'Merchant' },
          {
            key: 'notificationKind',
            label: 'Event',
            render: formatOperationTitle,
          },
          { key: 'audience', label: 'Audience', render: formatOperationTitle },
          {
            key: 'status',
            label: 'State',
            render: renderOperationStateBadge,
          },
        ]}
      />
    </div>
  );
}

export function ShippingOperations({
  data,
}: {
  data: AdminOperations['shipping'];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <OperationsIncidentTable
        title="Shipment exceptions"
        empty="No shipment failures require attention."
        rows={data.shipments}
        columns={[
          { key: 'merchantName', label: 'Merchant' },
          { key: 'provider', label: 'Provider' },
          {
            key: 'status',
            label: 'State',
            render: renderOperationStateBadge,
          },
          { key: 'updatedAt', label: 'Updated', render: formatOperationDate },
        ]}
      />
      <OperationsIncidentTable
        title="Shipping webhook failures"
        empty="No delayed or failed shipping webhooks."
        rows={data.webhooks}
        columns={[
          { key: 'provider', label: 'Provider' },
          { key: 'eventType', label: 'Event', render: formatOperationTitle },
          {
            key: 'processed',
            label: 'Processed',
            render: (value) =>
              value === true ? (
                <CheckCircle2 className="size-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="size-4 text-amber-600" />
              ),
          },
          { key: 'createdAt', label: 'Created', render: formatOperationDate },
        ]}
      />
    </div>
  );
}

export function WorkerOperations({
  workers,
}: {
  workers: AdminOperations['workers'];
}) {
  return (
    <OperationsIncidentTable
      title="Worker health"
      empty="No worker heartbeat has been recorded yet."
      rows={workers}
      columns={[
        { key: 'workerName', label: 'Worker' },
        {
          key: 'state',
          label: 'State',
          render: renderOperationStateBadge,
        },
        { key: 'processedCount', label: 'Processed' },
        {
          key: 'lastSucceededAt',
          label: 'Last success',
          render: formatOperationDate,
        },
        { key: 'lastErrorCode', label: 'Safe error code' },
        {
          key: 'updatedAt',
          label: 'Heartbeat',
          render: formatOperationDate,
        },
      ]}
    />
  );
}

export function ReadOnlyNotice() {
  return (
    <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
      <ShieldAlert className="mt-0.5 size-4 shrink-0" />
      <p>
        Payment, settlement, payout, notification and shipping incidents are
        read-only here. Investigate through their owned workflows; this console
        never triggers a universal retry.
      </p>
    </div>
  );
}

export function QueueState({
  queue,
}: {
  queue: EventPipelineData['operations']['queue'];
}) {
  const length = queue?.queue_length ?? '—';
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Clock3 className="size-4" /> Event queue depth:{' '}
      <span className="font-medium text-foreground">{String(length)}</span>
    </div>
  );
}
