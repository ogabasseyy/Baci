'use client';

import { Download, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiGet, fetchWithCsrf } from '@/lib/api-client';
import type { AdminReconciliationQuery } from '@/schemas/admin-reconciliation-query';
import type { AdminReconciliationData } from '@/schemas/admin-reconciliation-rpc';
import { ReconciliationActivity } from './reconciliation-activity';
import {
  ReconciliationMetricSkeletons,
  ReconciliationMetrics,
} from './reconciliation-metrics';

type Period = AdminReconciliationQuery['period'];
type Lane = AdminReconciliationQuery['lane'];
type Status = AdminReconciliationQuery['status'];
type Currency = AdminReconciliationQuery['currency'];

const INITIAL_QUERY: AdminReconciliationQuery = {
  currency: 'NGN',
  format: 'json',
  lane: 'all',
  limit: 50,
  period: '30d',
  status: 'all',
};

function buildSearchParams(query: AdminReconciliationQuery): URLSearchParams {
  const params = new URLSearchParams({
    currency: query.currency,
    lane: query.lane,
    limit: String(query.limit),
    period: query.period,
    status: query.status,
  });
  if (query.cursorAt && query.cursorId) {
    params.set('cursorAt', query.cursorAt);
    params.set('cursorId', query.cursorId);
  }
  if (query.merchantId) {
    params.set('merchantId', query.merchantId);
  }
  return params;
}

function requestReconciliation(
  query: AdminReconciliationQuery
): Promise<AdminReconciliationData> {
  return apiGet<AdminReconciliationData>(
    `/api/admin/reconciliation?${buildSearchParams(query).toString()}`
  );
}

export function ReconciliationClient() {
  const [query, setQuery] = useState<AdminReconciliationQuery>(INITIAL_QUERY);
  const [data, setData] = useState<AdminReconciliationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const latestLoadId = useRef(0);

  async function load(nextQuery: AdminReconciliationQuery, append = false) {
    const loadId = ++latestLoadId.current;
    if (append) setLoadingMore(true);
    else {
      setData(null);
      setLoading(true);
      setLoadingMore(false);
    }

    try {
      const response = await requestReconciliation(nextQuery);
      if (latestLoadId.current !== loadId) return;
      setData((current) =>
        append && current
          ? { ...response, items: [...current.items, ...response.items] }
          : response
      );
      setError(null);
    } catch {
      if (latestLoadId.current !== loadId) return;
      if (!append) setData(null);
      setError('Reconciliation data could not load.');
    } finally {
      if (latestLoadId.current === loadId) {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    }
  }

  useEffect(() => {
    const loadId = ++latestLoadId.current;
    setData(null);
    setLoading(true);
    setLoadingMore(false);
    void requestReconciliation(query)
      .then((response) => {
        if (latestLoadId.current !== loadId) return;
        setData(response);
        setError(null);
      })
      .catch(() => {
        if (latestLoadId.current !== loadId) return;
        setData(null);
        setError('Reconciliation data could not load.');
      })
      .finally(() => {
        if (latestLoadId.current === loadId) setLoading(false);
      });
  }, [query]);

  function updateFilter(
    field: 'currency' | 'period' | 'lane' | 'status',
    value: Currency | Period | Lane | Status
  ) {
    latestLoadId.current += 1;
    setQuery((current) => ({ ...current, [field]: value }));
  }

  async function exportCsv() {
    const exportQuery = { ...query, format: 'csv' as const, limit: 100 };
    setExporting(true);
    try {
      const response = await fetchWithCsrf('/api/admin/reconciliation', {
        body: JSON.stringify(exportQuery),
        method: 'POST',
      });
      if (!response.ok)
        throw new Error('Reconciliation export request failed.');

      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.download = 'baci-reconciliation-first-100.csv';
      anchor.href = url;
      anchor.click();
      URL.revokeObjectURL(url);
      setError(null);
    } catch {
      setError('Reconciliation export could not be generated.');
    } finally {
      setExporting(false);
    }
  }

  function loadMore() {
    if (!data?.nextCursor) return;
    void load(
      {
        ...query,
        cursorAt: data.nextCursor.createdAt,
        cursorId: data.nextCursor.id,
      },
      true
    );
  }

  const currencyOptions = Array.from(
    new Set([query.currency, ...(data?.supportedCurrencies ?? [])])
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-page-title">Reconciliation</h1>
          <p className="max-w-3xl text-muted-foreground">
            Read-only financial lanes for matching recorded commerce activity.
            Money totals are never combined across currencies. Historical
            settlement currency is unavailable, so settlement amounts are not
            displayed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void exportCsv()}
            disabled={loading || exporting}
          >
            <Download className="mr-2 size-4" aria-hidden="true" />
            {exporting ? 'Exporting…' : 'Export first 100 matching rows'}
          </Button>
          <Button
            variant="outline"
            onClick={() => void load(query)}
            disabled={loading}
          >
            <RefreshCw
              className={`mr-2 size-4 ${loading ? 'motion-safe:animate-spin' : ''}`}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </div>
      </div>

      <Card className="glass">
        <CardContent className="flex flex-col gap-3 pt-6 md:flex-row">
          <Select
            value={query.currency}
            onValueChange={(value: Currency) => updateFilter('currency', value)}
          >
            <SelectTrigger aria-label="Currency" className="md:w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currencyOptions.map((currency) => (
                <SelectItem key={currency} value={currency}>
                  {currency}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={query.period}
            onValueChange={(value: Period) => updateFilter('period', value)}
          >
            <SelectTrigger aria-label="Period" className="md:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={query.lane}
            onValueChange={(value: Lane) => updateFilter('lane', value)}
          >
            <SelectTrigger aria-label="Financial lane" className="md:w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All lanes</SelectItem>
              <SelectItem value="platform_settlement">
                Platform settlements
              </SelectItem>
              <SelectItem value="direct_settlement">
                Direct settlements
              </SelectItem>
              <SelectItem value="payout_request">Payout requests</SelectItem>
              <SelectItem value="refund">Refunds</SelectItem>
              <SelectItem value="review">Open reviews</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={query.status}
            onValueChange={(value: Status) => updateFilter('status', value)}
          >
            <SelectTrigger aria-label="Status" className="md:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="settled">Settled</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="refunded">Refunded</SelectItem>
              <SelectItem value="refund_pending">Refund pending</SelectItem>
              <SelectItem value="open">Open review</SelectItem>
              <SelectItem value="direct">Direct</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">Reconciliation data could not load.</p>
          <p>{error}</p>
        </div>
      ) : null}

      {loading && !data ? <ReconciliationMetricSkeletons /> : null}
      {data ? <ReconciliationMetrics data={data} /> : null}
      <ReconciliationActivity
        data={data}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
      />
    </div>
  );
}
