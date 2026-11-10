// @vitest-environment node
import { expect, it } from 'vitest';
import { digestBytes } from '../../src/lib/experience/manifest-digest';
import { startPublishedGateway } from './published-gateway';

it('serves anonymous stable digest-bound output with SRI, then denies it after withdrawal', async () => {
  let active = true;
  const build = 'a'.repeat(64);
  const origin = 'http://127.0.0.1:43174';
  const files = new Map([
    ['app.js', { mime: 'text/javascript', bytes: Buffer.from('export{}') }],
    ['app.css', { mime: 'text/css', bytes: Buffer.from('body{color:black}') }],
  ]);
  const reader = {
    manifest: async (slug: string) =>
      active && slug === 'qa1'
        ? { buildDigest: build, hostOrigin: origin, assets: [] }
        : null,
    read: async (_slug: string, _build: string, file: string) => {
      const f = files.get(file);
      return f ? { ...f, path: file, digest: digestBytes(f.bytes) } : null;
    },
  };
  const gateway = await startPublishedGateway(reader as never, origin);
  try {
    const path = `${gateway.origin}/published/qa1/${build}/`;
    const html = await fetch(`${path}index.html`);
    expect(html.status).toBe(200);
    expect(html.headers.get('set-cookie')).toBeNull();
    expect(html.headers.get('access-control-allow-origin')).toBe('*');
    expect(html.headers.get('content-security-policy')).toContain(
      "connect-src 'none'"
    );
    const source = await html.text();
    expect(source).toContain('sha256-');
    expect(source).toContain(`data-baci-experience-build="${build}"`);
    expect((await fetch(`${path}app.js`)).status).toBe(200);
    for (const suffix of [
      'source.tsx',
      'app.js.map',
      '%2e%2e/app.js',
      'assets/private-reference',
    ])
      expect((await fetch(path + suffix)).status).toBe(404);
    expect((await fetch(`${path}app.js`, { method: 'POST' })).status).toBe(404);
    expect(
      (await fetch(`${gateway.origin}/published/other/${build}/app.js`)).status
    ).toBe(404);
    active = false;
    expect((await fetch(`${path}app.js`)).status).toBe(404);
  } finally {
    await gateway.close();
  }
});
it('refuses output compiled for a different parent origin', async () => {
  const gateway = await startPublishedGateway(
    {
      manifest: async () => ({
        buildDigest: 'a'.repeat(64),
        hostOrigin: 'https://other.test',
      }),
    } as never,
    'http://127.0.0.1:43174'
  );
  try {
    expect(
      (
        await fetch(
          `${gateway.origin}/published/qa1/${'a'.repeat(64)}/index.html`
        )
      ).status
    ).toBe(404);
  } finally {
    await gateway.close();
  }
});

it('serves CSS for duplicate declared assets without doubling the published prefix', async () => {
  const build = 'a'.repeat(64);
  const assetId = 'b'.repeat(64);
  const hostOrigin = 'http://127.0.0.1:43174';
  const bytes = Buffer.from(`a{background:url('/assets/${assetId}')}`);
  const gateway = await startPublishedGateway(
    {
      manifest: async () => ({
        buildDigest: build,
        hostOrigin,
        assets: [{ assetId }, { assetId }],
      }),
      read: async () => ({
        path: 'app.css',
        bytes,
        mime: 'text/css',
        digest: digestBytes(bytes),
      }),
    } as never,
    hostOrigin
  );
  try {
    const base = `/published/qa1/${build}`;
    const response = await fetch(`${gateway.origin}${base}/app.css`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      `a{background:url('${base}/assets/${assetId}')}`
    );
  } finally {
    await gateway.close();
  }
});
