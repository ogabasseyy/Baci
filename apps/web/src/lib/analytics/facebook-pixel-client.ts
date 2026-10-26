import { isAnalyticsAllowed } from '@/lib/analytics-consent';

type FacebookQueue = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[][];
  loaded?: boolean;
  version?: string;
  push?: (...args: unknown[]) => void;
  disablePushState?: boolean;
};
let active: { id: string; token: symbol } | undefined;
const initialized = new WeakMap<FacebookQueue, Set<string>>();
export const validFacebookPixelId = (id: string): boolean =>
  /^\d{1,32}$/.test(id);

function sdk(): FacebookQueue {
  if (window.fbq) return window.fbq as FacebookQueue;
  const queue: FacebookQueue = (...args: unknown[]) => {
    if (queue.callMethod) queue.callMethod(...args);
    else queue.queue?.push(args);
  };
  queue.queue = [];
  queue.push = queue;
  queue.loaded = true;
  queue.version = '2.0';
  window.fbq = queue;
  (window as Window & { _fbq?: FacebookQueue })._fbq = queue;
  return queue;
}

export function activateFacebookPixel(id: string): (() => void) | undefined {
  if (!validFacebookPixelId(id) || !isAnalyticsAllowed()) return;
  const token = Symbol(id);
  active = { id, token };
  const fbq = sdk();
  fbq.disablePushState = true;
  fbq('consent', 'revoke');
  let ids = initialized.get(fbq);
  if (!ids) {
    ids = new Set();
    initialized.set(fbq, ids);
  }
  if (!ids.has(id)) {
    fbq('set', 'autoConfig', false, id);
    fbq('init', id);
    ids.add(id);
  }
  fbq('consent', 'grant');
  sendFacebookPixelEvent('PageView');
  return () => {
    if (active?.token !== token) return;
    active = undefined;
    fbq('consent', 'revoke');
  };
}

export function sendFacebookPixelEvent(
  event: string,
  data?: object,
  options?: { eventID: string }
): void {
  if (!active || !isAnalyticsAllowed() || typeof window === 'undefined') return;
  window.fbq?.(
    'trackSingle',
    active.id,
    event,
    data ?? {},
    ...(options ? [options] : [])
  );
}
