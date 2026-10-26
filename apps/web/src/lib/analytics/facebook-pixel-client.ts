import { isAnalyticsAllowed } from '@/lib/analytics-consent';

type FacebookQueue = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[][];
  loaded?: boolean;
  version?: string;
  push?: (...args: unknown[]) => void;
  disablePushState?: boolean;
};
type Observation = {
  url: string;
  event: string;
  data?: object;
  options?: { eventID: string };
};
let active:
  | { id: string; token: symbol; pathname: string; pending: Observation[] }
  | undefined;
const ready = new WeakSet<FacebookQueue>();
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
  active = { id, token, pathname: window.location.pathname, pending: [] };
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
  const fbq = window.fbq as FacebookQueue | undefined;
  if (!fbq || active.pathname !== window.location.pathname) return;
  if (!ready.has(fbq)) {
    if (active.pending.length < 50)
      active.pending.push({ url: window.location.href, event, data, options });
    return;
  }
  fbq(
    'trackSingle',
    active.id,
    event,
    data ?? {},
    ...(options ? [options] : [])
  );
}

/** Next Script onReady confirms the external SDK can consume measurements now. */
export function facebookPixelReady(): void {
  const fbq = window.fbq as FacebookQueue | undefined;
  if (!fbq) return;
  ready.add(fbq);
  if (
    !active ||
    !isAnalyticsAllowed() ||
    active.pathname !== window.location.pathname
  )
    return;
  const pending = active.pending;
  active.pending = [];
  for (const observation of pending) {
    // A queued observation belongs to the exact URL where it happened, while
    // ready sends follow the active pathname across query-only navigation.
    if (observation.url !== window.location.href) continue;
    sendFacebookPixelEvent(
      observation.event,
      observation.data,
      observation.options
    );
  }
}
