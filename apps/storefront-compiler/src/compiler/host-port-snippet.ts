export function buildFramedHostPortSnippet(): string {
  return `
let hostPort = null;
let hostInstanceId = '';
let hostBuildDigest = '';
let hostEpoch = 1;
let hostReqSeq = 0;
const hostPending = new Map();

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const onHostConnect = (event) => {
    if (
      !window.parent ||
      event.source !== window.parent ||
      event.origin !== 'https://usebaci.com' ||
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
    const nonce = event.data.nonce;
    hostPort.onmessage = (e) => {
      const m = e?.data;
      if (m?.type === 'bootstrap' && Number.isSafeInteger(m.bootstrap?.route?.epoch) && m.bootstrap.route.epoch >= hostEpoch) {
        hostEpoch = m.bootstrap.route.epoch;
      } else if (m?.type === 'route' && Number.isSafeInteger(m.route?.epoch) && m.route.epoch >= hostEpoch) {
        hostEpoch = m.route.epoch;
        hostPort?.postMessage({ type: 'route-ack', epoch: hostEpoch });
      } else if (m?.type === 'result' && typeof m.requestId === 'string') {
        const entry = hostPending.get(m.requestId);
        if (entry) {
          if (entry.timer !== null && typeof clearTimeout === 'function') clearTimeout(entry.timer);
          hostPending.delete(m.requestId);
          entry.resolve(m.result);
        }
      }
    };
    if (typeof hostPort.start === 'function') hostPort.start();
    hostPort.postMessage({ type: 'ready', nonce });
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

function sendFramedBridgeRequest(method, args, fallbackEpoch) {
  const capability = FRAMED_METHOD_CAPABILITY[method];
  if (!capability) {
    return Promise.resolve({ status: 'error', code: 'INVALID_REQUEST', message: 'Unsupported bridge method' });
  }
  if (!hostPort) {
    return Promise.resolve({
      status: 'error',
      code: 'LAUNCH_EXPIRED',
      message: 'Framed host channel is not connected',
    });
  }
  if (hostPending.size >= 128) {
    return Promise.resolve({
      status: 'error',
      code: 'QUOTA_EXCEEDED',
      message: 'Too many pending requests',
    });
  }
  const requestId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : \`req_\${Date.now()}_\${++hostReqSeq}\`;
  return new Promise((resolve) => {
    const timer =
      typeof setTimeout === 'function'
        ? setTimeout(() => {
            hostPending.delete(requestId);
            resolve({
              status: 'error',
              code: 'INVALID_REQUEST',
              message: 'Host bridge request timed out',
            });
          }, 4000)
        : null;
    hostPending.set(requestId, { resolve, timer });
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
    return Promise.resolve({
      status: 'error',
      code: 'INVALID_REQUEST',
      message: \`Catalog \${paramKey} exceeds maximum length\`,
    });
  }
  return sendFramedBridgeRequest(method, { [paramKey]: trimmedVal }, fallbackEpoch).then((raw) => {
    if (raw && typeof raw === 'object') {
      if (raw.status === 'ok' && raw.value !== undefined) {
        return { status: 'ok', value: raw.value };
      }
      if (raw.status === 'error' && typeof raw.code === 'string' && typeof raw.message === 'string') {
        return { status: 'error', code: raw.code, message: raw.message };
      }
    }
    return { status: 'error', code: 'SNAPSHOT_STALE', message: 'Invalid host catalog response' };
  });
}

function dispatchFramedNavigation(method, safePath, fallbackEpoch) {
  if (typeof safePath !== 'string' || safePath.length === 0 || safePath.length > 500) {
    return Promise.resolve({
      status: 'error',
      code: 'INVALID_REQUEST',
      message: 'Framed navigation path exceeds maximum length',
    });
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
`;
}
