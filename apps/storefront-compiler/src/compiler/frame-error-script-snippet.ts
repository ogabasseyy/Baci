import type { WorkerStorefrontManifest } from '../schemas/worker-manifest';
import { sha256Hex } from './manifest-source-digest';

export function buildFrameErrorModuleSource(
  manifest: Pick<
    WorkerStorefrontManifest,
    'merchantSlug' | 'previewOrigin' | 'hostOrigin'
  >
): string {
  const allowedOrigins = Array.from(
    new Set([
      'https://usebaci.com',
      `https://${manifest.merchantSlug}.usebaci.com`,
      ...(manifest.previewOrigin ? [manifest.previewOrigin] : []),
      ...(manifest.hostOrigin ? [manifest.hostOrigin] : []),
    ])
  );
  return `const ALLOWED = ${JSON.stringify(allowedOrigins)};
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  let reported = false;
  const onConnect = (event) => {
    if (
      reported ||
      !window.parent ||
      event.source !== window.parent ||
      !ALLOWED.includes(event.origin) ||
      event.data?.type !== 'baci-experience-connect' ||
      !event.ports ||
      !event.ports[0] ||
      typeof event.data.nonce !== 'string' ||
      typeof event.data.instanceId !== 'string' ||
      typeof event.data.buildDigest !== 'string'
    ) {
      return;
    }
    reported = true;
    const port = event.ports[0];
    if (typeof port.start === 'function') port.start();
    port.postMessage({ type: 'ready', nonce: event.data.nonce, readiness: 'react-commit/v1' });
    port.postMessage({ type: 'render-failed', nonce: event.data.nonce, code: 'HYDRATION_FAILED' });
    if (typeof window.removeEventListener === 'function') {
      window.removeEventListener('message', onConnect);
    }
  };
  window.addEventListener('message', onConnect);
}
`;
}

export function buildFrameErrorAsset(
  manifest: Pick<
    WorkerStorefrontManifest,
    'merchantSlug' | 'previewOrigin' | 'hostOrigin'
  >
): { path: string; source: string } {
  const source = buildFrameErrorModuleSource(manifest);
  const hash = sha256Hex([source]).slice(0, 12);
  return { path: `/_baci/assets/frame-error.${hash}.js`, source };
}
