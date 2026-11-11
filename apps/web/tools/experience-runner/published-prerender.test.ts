import { expect, it, vi } from 'vitest';
import { digestBytes } from '../../src/lib/experience/manifest-digest';
import { startPublishedGateway } from './published-gateway';

it('serves route-aware prerender HTML through the normal gateway and denies a head change during render', async () => {
  const build = 'a'.repeat(64);
  const origin = 'http://127.0.0.1:43174';
  let version = 1;
  let drift = false;
  const reader = {
    manifest: async () => ({
      buildDigest: build,
      hostOrigin: origin,
      version,
      assets: [],
    }),
    read: async (_s: string, _b: string, path: string) => ({
      path,
      mime: path.endsWith('.js') ? 'text/javascript' : 'text/css',
      bytes: Buffer.from(path === 'app.js' ? 'export{}' : ''),
      digest: digestBytes(path === 'app.js' ? 'export{}' : ''),
    }),
  };
  const gateway = await startPublishedGateway(reader as never, origin, 0, {
    render: async (input) => {
      expect(input.path).toBe('/pages/story');
      if (drift) version++;
      return '<!doctype html><h1>Full custom public HTML</h1>';
    },
  });
  try {
    const url = `${gateway.origin}/published/qa1/${build}/index.html?path=${encodeURIComponent('/pages/story')}`;
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Full custom public HTML');
    expect(response.headers.get('cache-control')).toBe('no-store');
    drift = true;
    expect((await fetch(url)).status).toBe(404);
    expect((await fetch(`${url}&approved=true`)).status).toBe(404);
  } finally {
    await gateway.close();
  }
});

it('loads independent verified resources concurrently before rendering, retaining the final head check', async () => {
  const started: string[] = [];
  let release: () => void = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const build = 'a'.repeat(64);
  const reader = {
    manifest: async () => ({
      buildDigest: build,
      hostOrigin: 'http://127.0.0.1:43174',
      assets: [{ assetId: 'logo' }],
    }),
    read: async (_slug: string, _build: string, path: string) => {
      started.push(path);
      await barrier;
      return {
        path,
        mime:
          path === 'app.js'
            ? 'text/javascript'
            : path === 'app.css'
              ? 'text/css'
              : 'image/png',
        bytes: Buffer.from(''),
        digest: digestBytes(''),
      };
    },
  };
  const gateway = await startPublishedGateway(
    reader as never,
    'http://127.0.0.1:43174',
    0,
    { render: async () => '<h1>Ready</h1>' }
  );
  const response = fetch(`${gateway.origin}/published/qa1/${build}/index.html`);
  try {
    await vi.waitFor(
      () => expect(started).toEqual(['app.js', 'app.css', 'assets/logo']),
      { timeout: 1000 }
    );
    release();
    expect((await response).status).toBe(200);
  } finally {
    release();
    await response;
    await gateway.close();
  }
});
