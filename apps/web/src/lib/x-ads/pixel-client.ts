'use client';
import { isMarketingAllowed } from '@/lib/marketing-consent';
import { parseXEventIds } from '@/lib/x-ads/parse-x-event-ids';
import type { XEventIds } from '@/schemas/x-ads-settings';

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
  merchantId?: string;
  prepared: boolean;
  initialized: boolean;
};
let current: Activation | undefined;
let configured: { pixelId: string; queue: Window['twq'] } | undefined;
export function resetXPixel(activation?: object): void {
  if (!activation) {
    current = undefined;
  } else if (current === activation) {
    if (current.prepared) {
      current.initialized = false;
      current.ready = false;
    } else current = undefined;
  }
}
function sameEvents(left: XEventIds, right: XEventIds): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every(
    (key) => left[key as keyof XEventIds] === right[key as keyof XEventIds]
  );
}
export function prepareXPixel(
  pixelId: string,
  eventIds: unknown,
  merchantId: string
): (() => void) | undefined {
  if (
    typeof window === 'undefined' ||
    !merchantId ||
    !/^[A-Za-z0-9]{1,64}$/.test(pixelId) ||
    !isMarketingAllowed()
  )
    return;
  const activation: Activation = {
    pixelId,
    events: parseXEventIds(eventIds) ?? {},
    ready: false,
    pending: [],
    merchantId,
    prepared: true,
    initialized: false,
  };
  current = activation;
  return () => {
    if (current === activation) current = undefined;
  };
}
export function initializeXPixel(
  pixelId: string,
  eventIds: unknown,
  merchantId?: string
): object | undefined {
  if (
    current?.prepared &&
    (current.merchantId !== merchantId || current.pixelId !== pixelId)
  )
    return;
  if (
    typeof window === 'undefined' ||
    !/^[A-Za-z0-9]{1,64}$/.test(pixelId) ||
    !isMarketingAllowed()
  ) {
    current = undefined;
    return;
  }
  const parsed = parseXEventIds(eventIds);
  if (
    current?.prepared &&
    (current.merchantId !== merchantId ||
      current.pixelId !== pixelId ||
      !sameEvents(current.events, parsed ?? {}))
  )
    return;
  const candidate = current?.prepared ? current : undefined;
  const activation: Activation = candidate ?? {
    pixelId,
    events: parsed ?? {},
    ready: false,
    pending: [],
    prepared: false,
    initialized: false,
  };
  activation.initialized = true;
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
  if (!current || current !== activation || !current.initialized || !window.twq)
    return;
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
    if (
      entry.url === window.location.href ||
      (current.prepared && entry.event !== 'pageView')
    )
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
