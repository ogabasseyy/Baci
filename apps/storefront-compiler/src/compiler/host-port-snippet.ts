import { buildFramedBridgeDispatchersSnippet } from './framed-bridge-dispatchers-snippet';

export function buildFramedHostPortSnippet(
  previewOrigin?: string,
  hostOrigin?: string
): string {
  const allowedOrigins = Array.from(
    new Set([
      'https://usebaci.com',
      ...(previewOrigin ? [previewOrigin] : []),
      ...(hostOrigin ? [hostOrigin] : []),
    ])
  );
  return `
const ALLOWED_HOST_ORIGINS = ${JSON.stringify(allowedOrigins)};
const TRUSTED_HOST_ORIGIN = ${JSON.stringify(hostOrigin ?? '')};
let hostPort = null;
let hostInstanceId = '';
let hostBuildDigest = '';
let hostNonce = '';
let hostEpoch = 1;
let hostReqSeq = 0;
let hostBootstrapReceived = false;
let hostRenderCommitted = false;
let hostCommittedEpoch = 0;
let hostRenderFailed = false;
let hostCommitSent = false;
let lastHostBootstrap = null;
let lastHostRoute = null;
let onHostBootstrapUpdate = null;
let onHostRouteUpdate = null;
const hostPending = new Map();

function registerHostStateHandlers(onBootstrap, onRoute) {
  onHostBootstrapUpdate = onBootstrap;
  onHostRouteUpdate = onRoute;
  if (lastHostBootstrap) {
    onBootstrap(lastHostBootstrap);
  }
  if (
    lastHostRoute &&
    (!lastHostBootstrap ||
      !Number.isSafeInteger(lastHostBootstrap.route?.epoch) ||
      lastHostRoute.epoch > lastHostBootstrap.route.epoch)
  ) {
    onRoute(lastHostRoute);
  }
}

function notifyHostRenderCommitted(epochArg) {
  if (hostRenderFailed) return;
  hostRenderCommitted = true;
  const effectiveEpoch =
    Number.isSafeInteger(epochArg) && epochArg >= 1 ? epochArg : hostEpoch;
  if (effectiveEpoch > hostCommittedEpoch) hostCommittedEpoch = effectiveEpoch;
  if (
    hostPort &&
    hostNonce &&
    hostBootstrapReceived &&
    !hostCommitSent &&
    (epochArg === undefined || hostCommittedEpoch >= hostEpoch)
  ) {
    hostCommitSent = true;
    hostPort.postMessage({ type: 'render-committed', nonce: hostNonce, epoch: hostEpoch });
  }
}

function notifyHostRenderFailed() {
  if (hostRenderFailed) return;
  hostRenderFailed = true;
  if (hostPort && hostNonce) {
    hostPort.postMessage({ type: 'render-failed', nonce: hostNonce, code: 'HYDRATION_FAILED' });
  }
}

function isAllowedConnectOrigin(origin) {
  if (ALLOWED_HOST_ORIGINS.includes(origin)) return true;
  try {
    const raw = typeof document !== 'undefined' ? document.getElementById('__BACI_STOREFRONT_STATE__')?.textContent : '';
    const slug = raw ? JSON.parse(raw)?.merchantSlug : '';
    return typeof slug === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) && origin === \`https://\${slug}.usebaci.com\`;
  } catch {
    return false;
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const onHostConnect = (event) => {
    if (
      !window.parent ||
      event.source !== window.parent ||
      !isAllowedConnectOrigin(event.origin) ||
      hostPort ||
      event.data?.type !== 'baci-experience-connect' ||
      !event.ports ||
      !event.ports[0] ||
      typeof event.data.nonce !== 'string' ||
      typeof event.data.instanceId !== 'string' ||
      typeof event.data.buildDigest !== 'string'
    ) {
      return;
    }
    hostPort = event.ports[0];
    hostInstanceId = event.data.instanceId;
    hostBuildDigest = event.data.buildDigest;
    hostNonce = event.data.nonce;
    hostPort.onmessage = (e) => {
      const m = e?.data;
      if (m?.type === 'bootstrap' && Number.isSafeInteger(m.bootstrap?.route?.epoch) && m.bootstrap.route.epoch >= hostEpoch) {
        hostEpoch = m.bootstrap.route.epoch;
        hostBootstrapReceived = true;
        lastHostBootstrap = m.bootstrap;
        lastHostRoute = m.bootstrap.route;
        let rerenderInFlight = false;
        if (typeof onHostBootstrapUpdate === 'function') {
          rerenderInFlight = onHostBootstrapUpdate(m.bootstrap) === true;
        }
        if (!rerenderInFlight && hostRenderCommitted && !hostRenderFailed && !hostCommitSent) {
          hostCommitSent = true;
          hostPort?.postMessage({ type: 'render-committed', nonce: hostNonce, epoch: hostEpoch });
        }
      } else if (m?.type === 'route' && Number.isSafeInteger(m.route?.epoch) && m.route.epoch >= hostEpoch) {
        hostEpoch = m.route.epoch;
        lastHostRoute = m.route;
        if (typeof onHostRouteUpdate === 'function') {
          onHostRouteUpdate(m.route);
        }
        hostPort?.postMessage({ type: 'route-ack', epoch: hostEpoch });
      } else if (m?.type === 'result' && typeof m.requestId === 'string') {
        const entry = hostPending.get(m.requestId);
        if (entry) {
          if (entry.timer !== null && typeof clearTimeout === 'function') clearTimeout(entry.timer);
          hostPending.delete(entry.requestId);
          entry.resolve(m.result);
        }
      }
    };
    if (typeof hostPort.start === 'function') hostPort.start();
    hostPort.postMessage({ type: 'ready', nonce: hostNonce, readiness: 'react-commit/v1' });
    if (hostRenderFailed) {
      hostPort.postMessage({ type: 'render-failed', nonce: hostNonce, code: 'HYDRATION_FAILED' });
    }
    if (typeof window.removeEventListener === 'function') {
      window.removeEventListener('message', onHostConnect);
    }
  };
  window.addEventListener('message', onHostConnect);
}

function isValidHostRouteState(v) {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Number.isSafeInteger(v.epoch) &&
    v.epoch >= 1 &&
    typeof v.routeId === 'string' &&
    v.params !== null &&
    typeof v.params === 'object' &&
    !Array.isArray(v.params) &&
    typeof v.canonicalPath === 'string' &&
    typeof v.publicDataRevision === 'string'
  );
}

const FRAMED_METHOD_CAPABILITY = {
  'catalog.collection': 'catalog.read',
  'catalog.product': 'catalog.read',
  'catalog.variants': 'catalog.read',
  'cart.readPublic': 'cart.read-public',
  'cart.reconcile': 'cart.mutate',
  'cart.add': 'cart.mutate',
  'cart.remove': 'cart.mutate',
  'cart.set_quantity': 'cart.mutate',
  'checkout.prepare': 'checkout.prepare',
  'checkout.open': 'checkout.open',
  'navigation.go': 'navigation',
  'navigation.open': 'navigation',
};
const CART_MUTATION_METHODS = new Set(['cart.add', 'cart.remove', 'cart.set_quantity', 'cart.reconcile']);

function sendFramedBridgeRequest(method, args, fallbackEpoch, timeoutMs = 10000) {
  const capability = FRAMED_METHOD_CAPABILITY[method];
  if (!capability) {
    return Promise.resolve({ status: 'error', code: 'INVALID_REQUEST', message: 'Unsupported bridge method' });
  }
  if (!hostPort) {
    return Promise.resolve({ status: 'error', code: 'LAUNCH_EXPIRED', message: 'Framed host channel is not connected' });
  }
  if (hostPending.size >= 128) {
    return Promise.resolve({ status: 'error', code: 'QUOTA_EXCEEDED', message: 'Too many pending requests' });
  }
  const requestId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : \`req_\${Date.now()}_\${++hostReqSeq}\`;
  const operationId = method === 'cart.reconcile' ? String(args?.operationId ?? '') : requestId;
  return new Promise((resolve) => {
    const timer =
      typeof setTimeout === 'function'
        ? setTimeout(() => {
            hostPending.delete(requestId);
            if (CART_MUTATION_METHODS.has(method)) {
              resolve({ status: 'indeterminate', operationId });
              return;
            }
            resolve({ status: 'error', code: 'INVALID_REQUEST', message: 'Host bridge request timed out' });
          }, timeoutMs)
        : null;
    hostPending.set(requestId, { resolve, timer, requestId });
    hostPort.postMessage({
      protocol: 'baci-commerce/1',
      instanceId: hostInstanceId,
      buildDigest: hostBuildDigest,
      routeEpoch: hostEpoch || fallbackEpoch,
      requestId,
      capability,
      method,
      args,
    });
  });
}
${buildFramedBridgeDispatchersSnippet()}
`;
}
