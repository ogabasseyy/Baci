import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AdminAuditEvent, AdminAuditTimeline } from '@/lib/admin-audit';
import { formatAdminAuditDate } from '@/lib/admin-audit-format';

export function AuditEventsTable({
  cursor,
  events,
  isLoading,
  isLoadingMore,
  loadError,
  onLoadMore,
}: {
  cursor: AdminAuditTimeline['nextCursor'];
  events: AdminAuditEvent[];
  isLoading: boolean;
  isLoadingMore: boolean;
  loadError: string | null;
  onLoadMore: () => void;
}) {
  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className="flex min-h-48 items-center justify-center text-muted-foreground"
        role="status"
      >
        <Loader2 className="mr-2 size-5 animate-spin" aria-hidden="true" />
        Loading audit events…
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        role="alert"
      >
        {loadError}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        No events match the current filters.
      </div>
    );
  }

  return (
    <div aria-busy={isLoadingMore}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Resource</TableHead>
            <TableHead>Changed fields</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => (
            <TableRow key={`${event.eventSource}:${event.eventId}`}>
              <TableCell className="whitespace-nowrap">
                {formatAdminAuditDate(event.occurredAt)}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{event.eventSource}</Badge>
              </TableCell>
              <TableCell>{event.actorKind}</TableCell>
              <TableCell className="font-mono text-xs">
                {event.action}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {event.resourceType}
              </TableCell>
              <TableCell>
                {event.changedFields.length > 0
                  ? event.changedFields.join(', ')
                  : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {cursor && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            onClick={onLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore && (
              <Loader2
                className="mr-2 size-4 animate-spin"
                aria-hidden="true"
              />
            )}
            {isLoadingMore ? 'Loading more…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
