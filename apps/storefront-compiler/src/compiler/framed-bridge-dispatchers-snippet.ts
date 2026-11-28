export function buildFramedBridgeDispatchersSnippet(): string {
  return `
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

let framedNavigationChain = Promise.resolve();
let framedNavBacklog = 0;

function dispatchFramedNavigationNow(method, safePath, fallbackEpoch, timeoutMs = 10000) {
  if (typeof safePath !== 'string' || safePath.length === 0 || safePath.length > 500) {
    return Promise.resolve({ status: 'error', code: 'INVALID_REQUEST', message: 'Framed navigation path exceeds maximum length' });
  }
  return sendFramedBridgeRequest(method, { path: safePath }, fallbackEpoch, timeoutMs).then((raw) => {
    if (raw && typeof raw === 'object') {
      if (method === 'navigation.open' && raw.status === 'ok' && typeof raw.value?.presented === 'boolean') {
        return { status: 'ok', value: { presented: raw.value.presented } };
      }
      if (method === 'navigation.go' && raw.status === 'ok' && isValidHostRouteState(raw.value)) {
        if (raw.value.epoch > hostEpoch) hostEpoch = raw.value.epoch;
        return { status: 'ok', value: raw.value };
      }
      if (method === 'navigation.open' && raw.status === 'error' && raw.code === 'INVALID_REQUEST' && raw.message === 'Use the trusted storefront link.') {
        return { status: 'ok', value: { presented: false } };
      }
      if (raw.status === 'error' && typeof raw.code === 'string' && typeof raw.message === 'string') {
        return { status: 'error', code: raw.code, message: raw.message };
      }
    }
    return { status: 'error', code: 'INVALID_REQUEST', message: 'Invalid host navigation response' };
  });
}

function dispatchFramedNavigation(method, safePath, fallbackEpoch) {
  if (method !== 'navigation.go') {
    return dispatchFramedNavigationNow(method, safePath, fallbackEpoch);
  }
  if (typeof safePath !== 'string' || safePath.length === 0 || safePath.length > 500) {
    return Promise.resolve({ status: 'error', code: 'INVALID_REQUEST', message: 'Framed navigation path exceeds maximum length' });
  }
  if (!hostPort) {
    return Promise.resolve({ status: 'error', code: 'LAUNCH_EXPIRED', message: 'Framed host channel is not connected' });
  }
  if (framedNavBacklog >= 16 || hostPending.size + framedNavBacklog >= 128) {
    return Promise.resolve({ status: 'error', code: 'QUOTA_EXCEEDED', message: 'Too many pending requests' });
  }
  framedNavBacklog++;
  const deadline = Date.now() + 10000;
  const next = framedNavigationChain
    .then(() => {
      const rem = deadline - Date.now();
      return rem <= 0
        ? { status: 'error', code: 'INVALID_REQUEST', message: 'Host bridge request timed out' }
        : dispatchFramedNavigationNow(method, safePath, fallbackEpoch, rem);
    })
    .finally(() => {
      framedNavBacklog--;
    });
  framedNavigationChain = next.catch(() => undefined);
  return next;
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
