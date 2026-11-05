import type {
  BridgeResult,
  CartBridgeResult,
  ExperienceMethod,
  PublicBootstrap,
  RouteState,
} from '@baci/shared/experience';
import { EXPERIENCE_METHOD_CAPABILITY } from '@baci/shared/experience/limits';
import { createCommerceClient } from './client';
export interface ConnectExperienceOptions {
  readiness?: 'react-commit/v1';
  previewOrigin?: string;
}
/** Execution-document port only. No owner cookies, cart tokens or tenant clients. */
export function connectExperience(
  hostOrigin: string,
  options: ConnectExperienceOptions = {}
) {
  const previewOrigin = options.previewOrigin;
  if (previewOrigin) {
    const preview = new URL(previewOrigin);
    if (
      preview.protocol !== 'https:' ||
      preview.origin !== previewOrigin ||
      preview.username ||
      preview.password
    )
      throw Error('INVALID_PREVIEW_ORIGIN');
  }
  let port: MessagePort | null = null;
  let instanceId = '';
  let buildDigest = '';
  let nonce = '';
  let epoch = 1;
  let currentBootstrap: PublicBootstrap | null = null;
  let renderFailed = false;
  let closed = false;
  const pending = new Map<
    string,
    {
      resolve: (v: BridgeResult<unknown> | CartBridgeResult) => void;
      timer: ReturnType<typeof setTimeout>;
      method: ExperienceMethod;
      operationId: string;
    }
  >();
  const listeners = new Set<(route: RouteState) => void>();
  const bootstrapListeners = new Set<(bootstrap: PublicBootstrap) => void>();
  let resolveReady!: (bootstrap: PublicBootstrap) => void;
  const ready = new Promise<PublicBootstrap>((r) => (resolveReady = r));
  const sendNow = async (
    method: ExperienceMethod,
    args: Record<string, unknown>
  ): Promise<BridgeResult<unknown> | CartBridgeResult> => {
    if (!port || closed)
      return {
        status: 'error',
        code: 'LAUNCH_EXPIRED',
        message: 'Preview unavailable.',
      };
    const requestId = crypto.randomUUID();
    const operationId =
      method === 'cart.reconcile' ? String(args.operationId) : requestId;
    if (pending.size >= 128)
      return {
        status: 'error',
        code: 'QUOTA_EXCEEDED',
        message: 'Too many pending requests.',
      };
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        if (
          [
            'cart.add',
            'cart.remove',
            'cart.set_quantity',
            'cart.reconcile',
          ].includes(method)
        ) {
          resolve({ status: 'indeterminate', operationId });
          return;
        }
        resolve({
          status: 'error',
          code: 'INVALID_REQUEST',
          message: 'Request timed out. Check operation status before retrying.',
        });
      }, 10000);
      pending.set(requestId, { resolve, timer, method, operationId });
      port?.postMessage({
        protocol: 'baci-commerce/1',
        instanceId,
        buildDigest,
        routeEpoch: epoch,
        requestId,
        capability: EXPERIENCE_METHOD_CAPABILITY[method],
        method,
        args,
      });
    });
  };
  let navigation: Promise<unknown> = Promise.resolve();
  const send = (
    method: ExperienceMethod,
    args: Record<string, unknown>
  ): Promise<BridgeResult<unknown> | CartBridgeResult> => {
    if (method !== 'navigation.go') return sendNow(method, args);
    const next = navigation.then(() => sendNow(method, args));
    navigation = next.catch(() => undefined);
    return next;
  };
  const connect = (event: MessageEvent) => {
    if (
      event.source !== window.parent ||
      (event.origin !== hostOrigin && event.origin !== previewOrigin) ||
      port ||
      closed ||
      event.data?.type !== 'baci-experience-connect' ||
      !event.ports[0] ||
      typeof event.data.nonce !== 'string'
    )
      return;
    port = event.ports[0];
    instanceId = event.data.instanceId;
    buildDigest = event.data.buildDigest;
    nonce = event.data.nonce;
    port.onmessage = (e) => {
      const m = e.data;
      if (m?.type === 'bootstrap') {
        if (
          !Number.isSafeInteger(m.bootstrap?.route?.epoch) ||
          m.bootstrap.route.epoch < epoch
        )
          return;
        epoch = m.bootstrap.route.epoch;
        currentBootstrap = m.bootstrap;
        resolveReady(m.bootstrap);
        for (const listener of bootstrapListeners) listener(m.bootstrap);
      } else if (m?.type === 'route') {
        if (!Number.isSafeInteger(m.route?.epoch) || m.route.epoch < epoch)
          return;
        epoch = m.route.epoch;
        for (const fn of listeners) fn(m.route);
        port?.postMessage({ type: 'route-ack', epoch });
      } else if (m?.type === 'result' && typeof m.requestId === 'string') {
        const p = pending.get(m.requestId);
        if (p) {
          clearTimeout(p.timer);
          pending.delete(m.requestId);
          p.resolve(m.result);
        }
      }
    };
    port.start();
    port.postMessage({
      type: 'ready',
      nonce,
      ...(options.readiness ? { readiness: options.readiness } : {}),
    });
    if (renderFailed && options.readiness === 'react-commit/v1')
      port.postMessage({
        type: 'render-failed',
        nonce,
        code: 'HYDRATION_FAILED',
      });
    window.removeEventListener('message', connect);
  };
  window.addEventListener('message', connect);
  return {
    commerce: createCommerceClient(send),
    ready,
    onBootstrap(fn: (bootstrap: PublicBootstrap) => void) {
      bootstrapListeners.add(fn);
      return () => {
        bootstrapListeners.delete(fn);
      };
    },
    onRoute(fn: (route: RouteState) => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    acknowledgeRenderCommit(committedEpoch: number) {
      if (
        options.readiness !== 'react-commit/v1' ||
        !port ||
        closed ||
        !currentBootstrap ||
        !Number.isSafeInteger(committedEpoch) ||
        committedEpoch !== epoch
      )
        return false;
      port.postMessage({
        type: 'render-committed',
        nonce,
        epoch: committedEpoch,
      });
      return true;
    },
    failRenderCommit() {
      if (options.readiness !== 'react-commit/v1' || closed) return;
      renderFailed = true;
      if (!port) return;
      port.postMessage({
        type: 'render-failed',
        nonce,
        code: 'HYDRATION_FAILED',
      });
    },
    destroy() {
      closed = true;
      window.removeEventListener('message', connect);
      port?.close();
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        if (
          [
            'cart.add',
            'cart.remove',
            'cart.set_quantity',
            'cart.reconcile',
          ].includes(p.method)
        ) {
          p.resolve({ status: 'indeterminate', operationId: p.operationId });
          continue;
        }
        p.resolve({
          status: 'error',
          code: 'LAUNCH_EXPIRED',
          message: 'Preview unavailable.',
        });
      }
      pending.clear();
      listeners.clear();
      bootstrapListeners.clear();
    },
  };
}
