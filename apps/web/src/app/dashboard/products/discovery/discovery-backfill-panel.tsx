'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchWithCsrf } from '@/lib/api-client';

type BatchResult = {
  scanned: number;
  generated: number;
  nextCursor: string | null;
  done: boolean;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function saveProgress(key: string, cursor: string | null, complete: boolean) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ cursor, complete }));
  } catch {
    // In-memory progress still works when storage is unavailable.
  }
}

export function DiscoveryBackfillPanel({ merchantId }: { merchantId: string }) {
  const progressKey = `discovery-backfill:${merchantId}`;
  const [running, setRunning] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [generated, setGenerated] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const stopRequested = useRef(false);
  const inProgress = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const endWait = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  const runVersion = useRef(0);

  useEffect(() => {
    runVersion.current += 1;
    mounted.current = true;
    inProgress.current = false;
    activeRequest.current = null;
    setRunning(false);
    setWaiting(false);
    setError(null);
    setScanned(0);
    setGenerated(0);
    setCursor(null);
    setComplete(false);
    try {
      const saved: unknown = JSON.parse(
        window.localStorage.getItem(progressKey) ?? 'null'
      );
      if (
        saved &&
        typeof saved === 'object' &&
        'cursor' in saved &&
        'complete' in saved &&
        (saved.cursor === null ||
          (typeof saved.cursor === 'string' &&
            UUID_PATTERN.test(saved.cursor))) &&
        typeof saved.complete === 'boolean'
      ) {
        setCursor(saved.cursor);
        setComplete(saved.complete);
      }
    } catch {
      // Ignore malformed or unavailable local storage.
    }
    return () => {
      runVersion.current += 1;
      mounted.current = false;
      stopRequested.current = true;
      activeRequest.current?.abort();
      endWait.current?.();
    };
  }, [progressKey]);

  const waitForQuota = async (seconds: number, isCurrentRun: () => boolean) => {
    let remaining = seconds;
    const maxTimerSeconds = Math.floor(2_147_483_647 / 1000);
    while (remaining > 0 && isCurrentRun() && !stopRequested.current) {
      const chunk = Math.min(remaining, maxTimerSeconds);
      await new Promise<void>((resolve) => {
        const finish = () => {
          window.clearTimeout(timeout);
          endWait.current = null;
          resolve();
        };
        const timeout = window.setTimeout(finish, chunk * 1000);
        endWait.current = finish;
      });
      remaining -= chunk;
    }
  };

  const run = async () => {
    if (inProgress.current) return;
    const version = runVersion.current;
    const isCurrentRun = () =>
      mounted.current && runVersion.current === version;
    inProgress.current = true;
    stopRequested.current = false;
    setRunning(true);
    setError(null);
    let nextCursor = complete ? null : cursor;
    if (complete) {
      setScanned(0);
      setGenerated(0);
      setCursor(null);
      setComplete(false);
      saveProgress(progressKey, null, false);
    }
    let needsVerification = nextCursor !== null;
    try {
      while (!stopRequested.current) {
        const controller = new AbortController();
        activeRequest.current = controller;
        const response = await fetchWithCsrf(
          '/api/products/discovery-backfill',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ merchantId, cursor: nextCursor }),
            signal: controller.signal,
          }
        );
        if (activeRequest.current === controller) activeRequest.current = null;
        if (
          !isCurrentRun() ||
          (stopRequested.current && response.status === 429)
        )
          break;
        if (!response.ok) {
          const payload: { error?: string; resetIn?: number } = await response
            .json()
            .catch(() => ({}));
          if (
            response.status === 429 &&
            typeof payload.resetIn === 'number' &&
            Number.isFinite(payload.resetIn) &&
            Number.isSafeInteger(Math.ceil(payload.resetIn)) &&
            payload.resetIn >= 0
          ) {
            if (stopRequested.current || !isCurrentRun()) break;
            setWaiting(true);
            await waitForQuota(
              Math.max(1, Math.ceil(payload.resetIn)),
              isCurrentRun
            );
            if (!isCurrentRun()) break;
            setWaiting(false);
            continue;
          }
          const retry =
            response.status === 429 && payload.resetIn
              ? ` Try again in ${payload.resetIn} seconds.`
              : '';
          throw new Error(`${payload.error ?? 'Indexing failed.'}${retry}`);
        }
        const result: BatchResult = await response.json();
        if (!isCurrentRun()) break;
        setScanned((count) => count + result.scanned);
        setGenerated((count) => count + result.generated);
        nextCursor = result.nextCursor;
        setCursor(nextCursor);
        if (result.done && needsVerification) {
          needsVerification = false;
          nextCursor = null;
          setCursor(null);
          saveProgress(progressKey, null, false);
          continue;
        }
        saveProgress(progressKey, nextCursor, result.done);
        if (result.done) {
          setComplete(true);
          break;
        }
      }
    } catch (cause) {
      if (isCurrentRun() && !stopRequested.current) {
        setError(
          cause instanceof Error ? cause.message : 'Indexing failed. Try again.'
        );
      }
    } finally {
      if (isCurrentRun()) {
        activeRequest.current = null;
        endWait.current?.();
        inProgress.current = false;
        setRunning(false);
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Catalog index</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          You can stop after the current batch and continue later, even after
          reloading this page. The indexer waits when it reaches its request
          limit and skips products whose searchable details have not changed.
        </p>
        <p role="status" className="text-sm">
          {complete
            ? 'Indexing complete.'
            : waiting
              ? 'Waiting for the request limit to reset…'
              : running
                ? 'Indexing products…'
                : cursor
                  ? 'Indexing paused.'
                  : 'Ready to index.'}{' '}
          {scanned} scanned this visit, {generated} updates confirmed.
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
                endWait.current?.();
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
