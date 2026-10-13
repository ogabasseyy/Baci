'use client';

import { Download, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import type { AdminAuditEvent, AdminAuditTimeline } from '@/lib/admin-audit';
import { formatAdminAuditDate } from '@/lib/admin-audit-format';
import { fetchWithCsrf } from '@/lib/api-client';
import { ADMIN_AUDIT_MAX_ROWS_PER_REQUEST } from '@/schemas/admin-audit-query';
import { type AuditFilters, loadAuditEvents } from './audit-events-data';
import { AuditEventsTable } from './audit-events-table';

export default function AdminAuditPage() {
  const { toast } = useToast();
  const [draftFilters, setDraftFilters] = useState<AuditFilters>({
    action: '',
    resourceType: '',
    source: 'all',
  });
  const [filters, setFilters] = useState<AuditFilters>(draftFilters);
  const [events, setEvents] = useState<AdminAuditEvent[]>([]);
  const [cursor, setCursor] = useState<AdminAuditTimeline['nextCursor']>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activityStatus, setActivityStatus] = useState('');
  const [asyncError, setAsyncError] = useState<string | null>(null);
  const latestLoadId = useRef(0);

  useEffect(() => {
    const loadId = ++latestLoadId.current;
    setIsLoading(true);
    setIsLoadingMore(false);
    setLoadError(null);
    setAsyncError(null);
    setActivityStatus('');
    loadAuditEvents(filters)
      .then((result) => {
        if (latestLoadId.current !== loadId) return;
        setEvents(result.data.events);
        setCursor(result.data.nextCursor);
        setGeneratedAt(result.generatedAt);
        setActivityStatus(
          `Loaded ${result.data.events.length} audit ${result.data.events.length === 1 ? 'event' : 'events'}.`
        );
      })
      .catch((error: unknown) => {
        if (latestLoadId.current !== loadId) return;
        console.error('Admin audit load failed:', error);
        setEvents([]);
        setCursor(null);
        setLoadError('The audit timeline could not be loaded.');
        setActivityStatus('');
      })
      .finally(() => {
        if (latestLoadId.current === loadId) setIsLoading(false);
      });
  }, [filters]);

  const replaceFilters = (nextFilters: AuditFilters) => {
    latestLoadId.current += 1;
    setFilters(nextFilters);
  };

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    replaceFilters({
      action: draftFilters.action.trim(),
      resourceType: draftFilters.resourceType.trim(),
      source: draftFilters.source,
    });
  };

  const refresh = () => replaceFilters({ ...filters });

  const loadMore = async () => {
    if (!cursor) return;
    const loadId = latestLoadId.current;
    setIsLoadingMore(true);
    setAsyncError(null);
    setActivityStatus('Loading more audit events.');
    try {
      const result = await loadAuditEvents(filters, cursor);
      if (latestLoadId.current !== loadId) return;
      setEvents((current) => [...current, ...result.data.events]);
      setCursor(result.data.nextCursor);
      setGeneratedAt(result.generatedAt);
      setActivityStatus(
        result.data.events.length > 0
          ? `Loaded ${result.data.events.length} more audit ${result.data.events.length === 1 ? 'event' : 'events'}.`
          : 'No more audit events are available.'
      );
    } catch (error) {
      if (latestLoadId.current !== loadId) return;
      console.error('Admin audit pagination failed:', error);
      setAsyncError('Could not load more audit events. Please try again.');
      setActivityStatus('');
      toast({
        title: 'Could not load more events',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      if (latestLoadId.current === loadId) setIsLoadingMore(false);
    }
  };

  const exportCsv = async () => {
    setIsExporting(true);
    setAsyncError(null);
    setActivityStatus('Preparing audit export.');
    try {
      const response = await fetchWithCsrf('/api/admin/audit-events/export', {
        body: JSON.stringify(filters),
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to export platform audit');

      const isPartial = response.headers
        .get('x-baci-audit-export-scope')
        ?.startsWith('partial');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = isPartial
        ? `baci-platform-audit-first-${ADMIN_AUDIT_MAX_ROWS_PER_REQUEST}-events.csv`
        : 'baci-platform-audit.csv';
      link.click();
      URL.revokeObjectURL(url);
      setActivityStatus(
        isPartial
          ? `Partial audit export downloaded: first ${ADMIN_AUDIT_MAX_ROWS_PER_REQUEST} matching events.`
          : 'Complete audit export downloaded.'
      );
    } catch (error) {
      console.error('Admin audit export failed:', error);
      setAsyncError('Audit export failed. Please try again.');
      setActivityStatus('');
      toast({
        title: 'Export failed',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <p aria-live="polite" className="sr-only" role="status">
        {activityStatus}
      </p>
      {asyncError && (
        <p className="sr-only" role="alert">
          {asyncError}
        </p>
      )}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-page-title">Platform audit trail</h1>
          <p className="text-muted-foreground">
            Privacy-safe timeline of system and operator activity. Values and
            personal data are never shown here. Exports include up to{' '}
            {ADMIN_AUDIT_MAX_ROWS_PER_REQUEST} matching events and are labeled
            partial when more records exist.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={refresh} disabled={isLoading}>
            <RefreshCw className="mr-2 size-4" aria-hidden="true" />
            Refresh
          </Button>
          <Button onClick={exportCsv} disabled={isExporting || isLoading}>
            {isExporting ? (
              <Loader2
                className="mr-2 size-4 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Download className="mr-2 size-4" aria-hidden="true" />
            )}
            Export matching events
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_auto]"
            onSubmit={applyFilters}
          >
            <Input
              aria-label="Filter by action"
              value={draftFilters.action}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  action: event.target.value,
                }))
              }
              placeholder="Action, e.g. audit.exported"
            />
            <Input
              aria-label="Filter by resource type"
              value={draftFilters.resourceType}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  resourceType: event.target.value,
                }))
              }
              placeholder="Resource type, e.g. audit_timeline"
            />
            <Select
              value={draftFilters.source}
              onValueChange={(value: AuditFilters['source']) =>
                setDraftFilters((current) => ({ ...current, source: value }))
              }
            >
              <SelectTrigger aria-label="Filter by source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="platform">Platform actions</SelectItem>
                <SelectItem value="canonical">Canonical events</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit">Apply</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          {generatedAt && (
            <p className="text-sm text-muted-foreground">
              Generated {formatAdminAuditDate(generatedAt)}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <AuditEventsTable
            cursor={cursor}
            events={events}
            isLoading={isLoading}
            isLoadingMore={isLoadingMore}
            loadError={loadError}
            onLoadMore={loadMore}
          />
        </CardContent>
      </Card>
    </div>
  );
}
