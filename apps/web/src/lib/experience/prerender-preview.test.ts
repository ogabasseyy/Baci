import type {
  ExperienceManifest,
  PublicBootstrap,
} from '@baci/shared/experience';
import { afterEach, expect, it, vi } from 'vitest';
import { digestBytes } from './manifest-digest';
import { consumePrerenderPreview } from './prerender-preview';
import { createPreviewVault } from './preview-service';

const requireOwner = vi.hoisted(() => vi.fn(async (ctx: unknown) => ctx));
vi.mock('./authorization', () => ({ requireExperienceOwner: requireOwner }));

afterEach(() => vi.clearAllMocks());

it('renders an owner preview from the current bootstrap and returns private ticketed output', async () => {
  const manifest: ExperienceManifest = {
    format: 'baci.experience/v2',
    runtime: 'react-browser-sandbox/v1',
    sdkVersion: 'commerce-bridge/v1',
    entry: 'Experience.tsx',
    files: [{ path: 'Experience.tsx', content: 'export default () => null' }],
    packages: [],
    routes: [{ path: '/', view: 'home' }],
    assets: [],
    capabilities: [],
  };
  const bootstrap: PublicBootstrap = {
    route: {
      epoch: 1,
      routeId: 'home',
      params: {},
      canonicalPath: '/',
      publicDataRevision: 'current',
    },
    catalog: { products: [], revision: 'current' },
    capabilities: [],
  };
  const bytes = Buffer.from('export{}');
  const vault = createPreviewVault({
    now: () => 100,
    isActive: async () => true,
    origin: 'http://127.0.0.1:4101',
  });
  const ref = vault.create({
    ownerId: 'owner',
    bindingId: 'binding',
    buildDigest: 'a'.repeat(64),
    files: [
      {
        path: 'app.js',
        mime: 'text/javascript',
        bytes,
        digest: digestBytes(bytes),
      },
    ],
  });
  const execute = vi.fn(async () => ({
    jobId: 'render-job',
    output: { format: 'baci-prerender/v1', html: '<main>Preview</main>' },
  }));
  const artifacts = {
    read: vi.fn(() => ({ javascript: 'export{}' })),
  };

  const result = await consumePrerenderPreview(
    { actorUserId: 'owner', merchantId: 'merchant' } as never,
    {
      buildId: 'build',
      buildDigest: 'a'.repeat(64),
      manifest,
      routeId: 'home',
      ref,
    },
    vault,
    {
      artifacts: artifacts as never,
      bootstrap: vi.fn(async () => bootstrap),
      execute: execute as never,
    }
  );

  expect(result.renderMode).toBe('prerender');
  expect(result.bootstrap.route.publicDataRevision).toBe('current');
  expect(execute).toHaveBeenCalledWith('prerender', {
    javascript: 'export{}',
    bootstrap: result.bootstrap,
  });
  expect(requireOwner).toHaveBeenCalledTimes(1);
  const ticket = new URL(result.src).pathname.split('/')[2];
  const html = await vault.read(ticket, 'index.html');
  expect(Buffer.from(html.bytes).toString()).toContain('<main>Preview</main>');
});
