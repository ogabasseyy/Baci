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
let current: { pixelId: string; events: XEventIds } | undefined;
let configured: { pixelId: string; queue: Window['twq'] } | undefined;
const allowed = isMarketingAllowed;
export function resetXPixel(): void {
  current = undefined;
}
export function initializeXPixel(pixelId: string, eventIds: unknown): void {
  current = undefined;
  if (typeof window === 'undefined' || !/^[A-Za-z0-9]{1,64}$/.test(pixelId))
    return;
  const parsed = xEventIdsSchema.safeParse(eventIds);
  current = { pixelId, events: parsed.success ? parsed.data : {} };
  if (!allowed()) return;
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
  if (configured?.pixelId !== pixelId || configured.queue !== window.twq) {
    window.twq('config', pixelId);
    configured = { pixelId, queue: window.twq };
  }
}
/** Browser observations never assert that an order was paid. */
export function measureXEvent(
  event: keyof XEventIds,
  params: Record<string, unknown>
): void {
  if (!allowed() || !current || !window.twq || event === 'purchase') return;
  const id = current.events[event];
  if (!id?.startsWith(`tw-${current.pixelId}-`)) return;
  window.twq('event', id, params);
}
