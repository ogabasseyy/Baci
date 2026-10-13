'use client';

import { AlertTriangle, Play, RadioTower } from 'lucide-react';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { replayEventPipelineIncident } from './operations-data';
import type {
  EventPipelineData,
  EventPipelineIncident,
} from './operations-types';

type ReplayTarget = {
  incident: EventPipelineIncident;
  kind: 'delivery' | 'ingress';
};

function incidentTime(incident: EventPipelineIncident) {
  const value = incident.updated_at ?? incident.first_failed_at;
  return value ? new Date(value).toLocaleString() : '—';
}

function IncidentRows({
  canReplay,
  incidents,
  kind,
  onReplay,
}: {
  canReplay: boolean;
  incidents: EventPipelineIncident[];
  kind: 'delivery' | 'ingress';
  onReplay: (target: ReplayTarget) => void;
}) {
  if (incidents.length === 0)
    return (
      <p className="py-4 text-sm text-muted-foreground">
        No incidents in this queue.
      </p>
    );
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Event</TableHead>
            <TableHead>Destination</TableHead>
            <TableHead>Safe error code</TableHead>
            <TableHead>Attempts</TableHead>
            <TableHead>Updated</TableHead>
            {canReplay ? (
              <TableHead>
                <span className="sr-only">Replay</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {incidents.map((incident) => (
            <TableRow key={incident.id}>
              <TableCell>{incident.event_name ?? '—'}</TableCell>
              <TableCell>{incident.destination ?? 'Ingress'}</TableCell>
              <TableCell>
                <Badge variant="outline">
                  {incident.failure_code ??
                    incident.last_error_code ??
                    'unknown'}
                </Badge>
              </TableCell>
              <TableCell>{incident.attempts ?? '—'}</TableCell>
              <TableCell>{incidentTime(incident)}</TableCell>
              {canReplay ? (
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onReplay({ incident, kind })}
                  >
                    <Play className="mr-1 size-3" />
                    Replay
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function EventPipelineOperations({
  canReplay,
  data,
  onComplete,
}: {
  canReplay: boolean;
  data: EventPipelineData;
  onComplete: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [replaying, setReplaying] = useState(false);
  const [target, setTarget] = useState<ReplayTarget | null>(null);
  const canConfirmReplay = canReplay && reason.trim().length >= 3;

  const confirmReplay = async () => {
    if (!target || !canConfirmReplay) return;
    setReplaying(true);
    try {
      const result = await replayEventPipelineIncident(
        target.incident,
        target.kind,
        reason.trim()
      );
      toast({
        title: 'Replay queued',
        description: `${result.replayed} event${result.replayed === 1 ? '' : 's'} queued for the existing worker.`,
      });
      setTarget(null);
      setReason('');
      onComplete();
    } catch {
      toast({
        title: 'Replay failed',
        description:
          'No changes were made. Review the incident and try again only after its cause is addressed.',
        variant: 'destructive',
      });
    } finally {
      setReplaying(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <RadioTower className="size-4" />
                Event pipeline queue
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {data.counts.ingress} ingress, {data.counts.deliveries}{' '}
                delivery, and {data.counts.unknown} uncertain-delivery
                incidents.
              </p>
            </div>
            <AlertTriangle className="size-5 text-amber-500" />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {canReplay
              ? 'Replays require an operator reason, use a permission-gated endpoint, and do not expose event payloads or provider responses.'
              : 'This is a read-only incident view. Replay controls require operations management permission.'}
          </p>
        </CardContent>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Ingress dead letters</CardTitle>
          </CardHeader>
          <CardContent>
            <IncidentRows
              canReplay={canReplay}
              incidents={data.ingress}
              kind="ingress"
              onReplay={setTarget}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Delivery dead letters</CardTitle>
          </CardHeader>
          <CardContent>
            <IncidentRows
              canReplay={canReplay}
              incidents={data.deliveries}
              kind="delivery"
              onReplay={setTarget}
            />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Delivery outcome unknown</CardTitle>
        </CardHeader>
        <CardContent>
          <IncidentRows
            canReplay={canReplay}
            incidents={data.unknown}
            kind="delivery"
            onReplay={setTarget}
          />
        </CardContent>
      </Card>
      {canReplay ? (
        <AlertDialog
          open={target !== null}
          onOpenChange={(open) => {
            if (!open && !replaying) setTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Replay this pipeline incident?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Replay only after the root cause has been corrected. The worker
                will process the existing event using its original contract; no
                payload can be edited here.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              aria-label="Replay reason"
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is replay now safe?"
            />
            <AlertDialogFooter>
              <AlertDialogCancel disabled={replaying}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={!canConfirmReplay || replaying}
                onClick={(event) => {
                  event.preventDefault();
                  void confirmReplay();
                }}
              >
                {replaying ? 'Queueing…' : 'Confirm replay'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
