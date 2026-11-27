export function buildFramedHostPortSnippet(previewOrigin?: string): string {
  const allowedOrigins = previewOrigin
    ? Array.from(new Set(['https://usebaci.com', previewOrigin]))
    : ['https://usebaci.com'];
  return `
const ALLOWED_HOST_ORIGINS = ${JSON.stringify(allowedOrigins)};
let hostPort = null;
let hostInstanceId = '';
let hostBuildDigest = '';
let hostNonce = '';
let hostEpoch = 1;
let hostReqSeq = 0;
let hostBootstrapReceived = false;
let hostRenderCommitted = false;
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

function notifyHostRenderCommitted() {
  if (hostRenderFailed) return;
  hostRenderCommitted = true;
  if (hostPort && hostNonce && hostBootstrapReceived && !hostCommitSent) {
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

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const onHostConnect = (event) => {
    if (
      !window.parent ||
      event.source !== window.parent ||
      !ALLOWED_HOST_ORIGINS.includes(event.origin) ||
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
        if (typeof onHostBootstrapUpdate === 'function') {
          onHostBootstrapUpdate(m.bootstrap);
        }
        if (hostRenderCommitted && !hostRenderFailed && !hostCommitSent) {
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

function sendFramedBridgeRequest(method, args, fallbackEpoch) {
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
          }, 4000)
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

function dispatchFramedCatalog(method, paramKey, trimmedVal, fallbackEpoch) {
  if (trimmedVal.length > 100) {
    return Promise.resolve({ status: 'error', code: 'INVALID_REQUEST', message: \`Catalog \${paramKey} exceeds maximum length\` });
  }
  return sendFramedBridgeRequest(method, { [paramKey]: trimmedVal }, fallbackEpoch).then((raw) => {
    if (raw && typeof raw === 'object') {
      if (raw.status === 'ok' && raw.value !== undefined) return { status: 'ok', value: raw.value };
      if (raw.status === 'error' && typeof raw.code === 'string' && typeof raw.message === 'string') {
        return { status: 'error', code: raw.code, message: raw.message };
      }
    }
    return { status: 'error', code: 'SNAPSHOT_STALE', message: 'Invalid host catalog response' };
  });
}

function dispatchFramedNavigation(method, safePath, fallbackEpoch) {
  if (typeof safePath !== 'string' || safePath.length === 0 || safePath.length > 500) {
    return Promise.resolve({ status: 'error', code: 'INVALID_REQUEST', message: 'Framed navigation path exceeds maximum length' });
  }
  return sendFramedBridgeRequest(method, { path: safePath }, fallbackEpoch).then((raw) => {
    if (raw && typeof raw === 'object') {
      if (method === 'navigation.open' && raw.status === 'ok' && typeof raw.value?.presented === 'boolean') {
        return { status: 'ok', value: { presented: raw.value.presented } };
      }
      if (method === 'navigation.go' && raw.status === 'ok' && isValidHostRouteState(raw.value)) {
        if (raw.value.epoch > hostEpoch) hostEpoch = raw.value.epoch;
        return { status: 'ok', value: raw.value };
      }
      if (raw.status === 'error' && typeof raw.code === 'string' && typeof raw.message === 'string') {
        return { status: 'error', code: raw.code, message: raw.message };
      }
    }
    return { status: 'error', code: 'INVALID_REQUEST', message: 'Invalid host navigation response' };
  });
}

function dispatchFramedCartOrCheckout(method, args, fallbackEpoch) {
  const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  return sendFramedBridgeRequest(method, safeArgs, fallbackEpoch).then((raw) => {
    if (raw && typeof raw === 'object') {
      if (raw.status === 'error' && typeof raw.code === 'string' && typeof raw.message === 'string') {
        return { status: 'error', code: raw.code, message: raw.message };
      }
      if (method === 'checkout.prepare' && raw.status === 'ok' && typeof raw.value?.ready === 'boolean') {
        return { status: 'ok', value: { ready: raw.value.ready } };
      }
      if (method === 'checkout.open' && raw.status === 'ok' && typeof raw.value?.presented === 'boolean') {
        return { status: 'ok', value: { presented: raw.value.presented } };
      }
      if (
        method.startsWith('cart.') &&
        raw.status === 'ok' &&
        raw.value &&
        typeof raw.value === 'object' &&
        !Array.isArray(raw.value)
      ) {
        return { status: 'ok', value: raw.value };
      }
      if (CART_MUTATION_METHODS.has(method)) {
        if (raw.status === 'conflict' && Number.isSafeInteger(raw.currentVersion)) {
          return { status: 'conflict', currentVersion: raw.currentVersion };
        }
        if (raw.status === 'indeterminate' && typeof raw.operationId === 'string') {
          return { status: 'indeterminate', operationId: raw.operationId };
        }
      }
    }
    return { status: 'error', code: 'INVALID_REQUEST', message: 'Invalid host commerce response' };
  });
}
`;
}
