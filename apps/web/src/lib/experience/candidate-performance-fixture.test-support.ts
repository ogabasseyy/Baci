import { type ExperienceManifest, sourceDigest } from '@baci/shared/experience';
import { vi } from 'vitest';
import { digestBytes } from './manifest-digest';

const manifest: ExperienceManifest = {
  format: 'baci.experience/v2',
  runtime: 'react-browser-sandbox/v1',
  sdkVersion: 'commerce-bridge/v1',
  entry: 'Experience.tsx',
  files: [{ path: 'Experience.tsx', content: 'export default () => null' }],
  packages: [],
  routes: [
    { path: '/', view: 'home' },
    { path: '/products/[handle]', view: 'product' },
  ],
  assets: [],
  capabilities: [],
};
export const candidate = {
  hostOrigin: 'http://127.0.0.1:4100',
  javascript: 'export default 1;',
  css: '',
  imports: [],
  digest: digestBytes('candidate'),
};
export const routeBootstrap = (view: 'home' | 'product') => ({
  route: {
    epoch: 1,
    routeId: view,
    canonicalPath: view === 'home' ? '/' : '/products/sample-item',
    params: view === 'home' ? {} : { handle: 'sample-item' },
    publicDataRevision: 'revision',
  },
  catalog: {
    products:
      view === 'product'
        ? [
            {
              id: 'product-id',
              slug: 'sample-item',
              name: 'Sample item',
              price: 1,
              currency: 'NGN',
              image: null,
              variants: [],
              canonicalPath: '/products/sample-item',
            },
          ]
        : [],
    revision: 'revision',
  },
  capabilities: [],
});
export const output = (input: unknown, extra: Record<string, unknown> = {}) => {
  const request = input as {
    width: 390 | 1440;
    bundle: { digest: string };
    bootstrap: { route: { canonicalPath: string } };
  };
  return {
    format: 'baci.performance-sample/v1',
    policyId: 'chromium-native-reference/v1',
    browser: 'Chromium 140',
    route: request.bootstrap.route.canonicalPath,
    width: request.width,
    buildDigest: request.bundle.digest,
    cache: 'cold-context',
    hostLcpMs: 900,
    frameLcpMs: 850,
    hostCls: 0,
    frameCls: 0,
    diagnostics: {
      host: {
        rawCls: 0.04,
        firstPaintMs: 123,
        rawLayoutShifts: [
          { startTime: 100, value: 0.04, hadRecentInput: false },
        ],
        layoutShiftOverflow: false,
      },
      frame: {
        rawCls: 0.08,
        firstPaintMs: 125,
        rawLayoutShifts: [
          { startTime: 101, value: 0.08, hadRecentInput: false },
        ],
        layoutShiftOverflow: false,
      },
    },
    interactionDurationMs: null,
    contentVisible: true,
    imagesDecoded: true,
    consoleErrors: 0,
    contaminated: false,
    observationWindowMs: 2000,
    ...extra,
  };
};
export const makeInput = (execute: ReturnType<typeof vi.fn>) => ({
  execute,
  manifest,
  bootstrap: vi.fn(async (view: 'home' | 'product') => routeBootstrap(view)),
  candidate,
  renderer: candidate,
  rendererKind: 'client' as 'client' | 'prerender',
  assets: [] as Array<{
    assetId: string;
    digest: string;
    mime: 'image/png' | 'font/woff2';
    bytesBase64: string;
  }>,
  sourceDigest: sourceDigest(manifest),
  hostContaminated: () => false,
});
