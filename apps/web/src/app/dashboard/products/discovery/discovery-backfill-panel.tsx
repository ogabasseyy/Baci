'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchWithCsrf } from '@/lib/api-client';

type BatchResult = {
  scanned: number;
  generated: number;
  nextCursor: string | null;
  done: boolean;
};

export function DiscoveryBackfillPanel({ merchantId }: { merchantId: string }) {
  const [running, setRunning] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [generated, setGenerated] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRequested = useRef(false);
  const inProgress = useRef(false);

  const run = async () => {
    if (inProgress.current) return;
    inProgress.current = true;
    stopRequested.current = false;
    setRunning(true);
    setError(null);
    let nextCursor = complete ? null : cursor;
    if (complete) {
      setScanned(0);
      setGenerated(0);
      setComplete(false);
    }
    try {
      while (!stopRequested.current) {
        const response = await fetchWithCsrf(
          '/api/products/discovery-backfill',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ merchantId, cursor: nextCursor }),
          }
        );
        if (!response.ok) {
          const payload: { error?: string; resetIn?: number } = await response
            .json()
            .catch(() => ({}));
          const retry =
            response.status === 429 && payload.resetIn
              ? ` Try again in ${payload.resetIn} seconds.`
              : '';
          throw new Error(`${payload.error ?? 'Indexing failed.'}${retry}`);
        }
        const result: BatchResult = await response.json();
        setScanned((count) => count + result.scanned);
        setGenerated((count) => count + result.generated);
        nextCursor = result.nextCursor;
        setCursor(nextCursor);
        if (result.done) {
          setComplete(true);
          break;
        }
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Indexing failed. Try again.'
      );
    } finally {
      inProgress.current = false;
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Catalog index</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          You can stop after the current batch and continue later. Repeating a
          run skips products whose searchable details have not changed.
        </p>
        <p role="status" className="text-sm">
          {complete
            ? 'Indexing complete.'
            : running
              ? 'Indexing products…'
              : cursor
                ? 'Indexing paused.'
                : 'Ready to index.'}{' '}
          {scanned} scanned, {generated} updated.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button disabled={running} onClick={() => void run()}>
            {complete
              ? 'Check for updates'
              : cursor
                ? 'Continue indexing'
                : 'Start indexing'}
          </Button>
          {running && (
            <Button
              variant="outline"
              onClick={() => {
                stopRequested.current = true;
              }}
            >
              Stop after this batch
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
