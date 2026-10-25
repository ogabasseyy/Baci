'use client';

import { useEffect, useRef, useState } from 'react';
import { oxygenLocalAttempt } from '@/components/storefront/ogabassey/pages/checkout/oxygen-local-attempt';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  type OxygenFormDraft,
  oxygenDraftResponseSchema,
} from '@/schemas/oxygen-form-draft';

const endpoint = '/api/payments/oxygen/draft';
type Status = 'loading' | 'saved' | 'saving' | 'error' | 'conflict';
type Pending = { draft: OxygenFormDraft; key: string };

/** Keeps sensitive draft values in memory; only the authenticated server persists them. */
export function useOxygenDraft(workflowId?: string) {
  const [initial, setInitial] = useState<OxygenFormDraft | null>(null);
  const [ready, setReady] = useState(!workflowId);
  const [status, setStatus] = useState<Status>(
    workflowId ? 'loading' : 'saved'
  );
  const version = useRef(0);
  const pending = useRef<Pending | null>(null);
  const outstanding = useRef<Pending | null>(null);
  const running = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocked = useRef(false);
  const active = useRef(true);
  const generation = useRef(0);
  const currentFlush = useRef<() => Promise<boolean>>(async () => false);

  async function load() {
    if (!workflowId) return;
    const token = ++generation.current;
    setStatus('loading');
    try {
      const source = oxygenLocalAttempt(
        new URLSearchParams(window.location.search)
      )?.source;
      const response = await fetchWithCsrf(
        `${endpoint}?workflowId=${workflowId}${source ? `&sourceWorkflowId=${source}` : ''}`,
        { cache: 'no-store' }
      );
      if (!response.ok) throw new Error('Unavailable');
      const body = oxygenDraftResponseSchema.parse(await response.json());
      if (!active.current || generation.current !== token) return;
      version.current = body.version;
      setInitial(body.draft);
      setReady(true);
      setStatus('saved');
    } catch {
      if (active.current && generation.current === token) setStatus('error');
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load is scoped to the workflow identifier.
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      generation.current++;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [workflowId]);

  async function flush(): Promise<boolean> {
    if (!workflowId) return true;
    if (timer.current) clearTimeout(timer.current);
    if (blocked.current || !ready) return false;
    if (running.current) return running.current;
    const token = generation.current;
    const task = (async () => {
      while (pending.current || outstanding.current) {
        const next = outstanding.current ?? pending.current;
        if (!next) break;
        outstanding.current = next;
        if (pending.current === next) pending.current = null;
        setStatus('saving');
        try {
          const response = await fetchWithCsrf(endpoint, {
            method: 'PUT',
            keepalive: true,
            body: JSON.stringify({
              workflowId,
              version: version.current,
              idempotencyKey: next.key,
              draft: next.draft,
            }),
          });
          if (generation.current !== token) return false;
          if (response.status === 409) {
            blocked.current = true;
            if (active.current) setStatus('conflict');
            return false;
          }
          if (!response.ok) throw new Error('Unavailable');
          const body = await response.json();
          if (!Number.isSafeInteger(body.version) || body.version < 0)
            throw new Error('Unavailable');
          if (generation.current !== token) return false;
          version.current = body.version;
          // Keep remounted form sections aligned with the last acknowledged save.
          if (active.current) setInitial(next.draft);
          outstanding.current = null;
        } catch {
          if (active.current && generation.current === token)
            setStatus('error');
          return false;
        }
      }
      if (active.current) setStatus('saved');
      return true;
    })();
    running.current = task;
    try {
      return await task;
    } finally {
      running.current = null;
    }
  }

  currentFlush.current = flush;
  useEffect(() => {
    const flushPending = () => {
      void currentFlush.current();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushPending();
    };
    window.addEventListener('pagehide', flushPending);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushPending);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  function queue(draft: OxygenFormDraft) {
    if (!workflowId || !ready || blocked.current) return;
    pending.current = { draft, key: crypto.randomUUID() };
    setStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  }
  return {
    initial,
    ready,
    status,
    queue,
    flush,
    retry: () => (ready ? flush() : load()),
  };
}
