'use client';
import { isMarketingAllowed } from '@/lib/marketing-consent';
import { type XEventIds, xEventIdsSchema } from '@/schemas/x-ads-settings';

type XQueue = ((
  action: string,
  event: string,
  params?: Record<string, unknown>
) => void) & {
  queue?: unknown[][];
  version?: string;
  exe?: (...args: unknown[]) => void;
};
declare global {
  interface Window {
    twq?: XQueue;
  }
}
type Pending = {
  event: keyof XEventIds;
  params: Record<string, unknown>;
  url: string;
};
type Activation = {
  pixelId: string;
  events: XEventIds;
  ready: boolean;
  pending: Pending[];
};
let current: Activation | undefined;
let configured: { pixelId: string; queue: Window['twq'] } | undefined;
export function resetXPixel(activation?: object): void {
  if (!activation || current === activation) current = undefined;
}
export function initializeXPixel(
  pixelId: string,
  eventIds: unknown
): object | undefined {
  current = undefined;
  if (
    typeof window === 'undefined' ||
    !/^[A-Za-z0-9]{1,64}$/.test(pixelId) ||
    !isMarketingAllowed()
  )
    return;
  const parsed = xEventIdsSchema.safeParse(eventIds);
  const activation: Activation = {
    pixelId,
    events: parsed.success ? parsed.data : {},
    ready: false,
    pending: [],
  };
  current = activation;
  if (!window.twq) {
    const queue: unknown[][] = [];
    const stub: XQueue = Object.assign(
      (...args: [string, string, Record<string, unknown>?]) => {
        if (stub.exe) stub.exe(...args);
        else queue.push(args);
      },
      { queue, version: '1.1' }
    );
    window.twq = stub as XQueue;
  }
  return activation;
}
/** Called only by the mounted Next Script's readiness notification. */
export function markXPixelReady(activation: object | undefined): void {
  if (!current || current !== activation || !window.twq) return;
  if (!isMarketingAllowed()) {
    current.pending = [];
    return;
  }
  current.ready = true;
  if (
    configured?.pixelId !== current.pixelId ||
    configured.queue !== window.twq
  ) {
    window.twq('config', current.pixelId);
    configured = { pixelId: current.pixelId, queue: window.twq };
  }
  const pending = current.pending.splice(0);
  for (const entry of pending)
    if (entry.url === window.location.href)
      measureXEvent(entry.event, entry.params);
}
/** Browser observations never assert that an order was paid. */
export function measureXEvent(
  event: keyof XEventIds,
  params: Record<string, unknown>
): void {
  if (!current || typeof window === 'undefined' || event === 'purchase') return;
  if (!isMarketingAllowed()) {
    current.pending = [];
    return;
  }
  const id = current.events[event];
  if (!id?.startsWith(`tw-${current.pixelId}-`)) return;
  if (!current.ready) {
    if (current.pending.length < 100)
      current.pending.push({
        event,
        params: { ...params },
        url: window.location.href,
      });
    return;
  }
  window.twq?.('event', id, params);
}
