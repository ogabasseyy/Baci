import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runOgabasseyLayoutFeasibilityFixture } from './run-ogabassey-layout-feasibility-fixture';

function htmlResponse(label: string) {
  return new Response(
    `<html><head><link rel="stylesheet" href="/_next/static/css/${label}.css"><script src="/_next/static/chunks/${label}.js"></script></head><body>${label}</body></html>`,
    { headers: { 'content-type': 'text/html' }, status: 200 }
  );
}

describe('runOgabasseyLayoutFeasibilityFixture', () => {
  it('captures actual home and isolation routes with their linked dependencies', async () => {
    const outputDir = await mkdtemp(
      path.join(tmpdir(), 'baci-layout-captures-')
    );
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === 'string' || input instanceof URL ? input : input.url
      );
      if (url.pathname.endsWith('.css')) {
        return new Response(`.${path.basename(url.pathname, '.css')}{}`, {
          status: 200,
        });
      }
      return htmlResponse(
        url.pathname.replaceAll('/', '-').replace(/^-|-$/g, '') || 'root'
      );
    });

    const manifest = await runOgabasseyLayoutFeasibilityFixture({
      baseUrl: 'http://127.0.0.1:4317',
      blogPath: 'blog/fixture-post',
      categoryPath: 'phones',
      fetchImpl,
      genericIdentifier: 'cwv-layout-generic-fixture',
      identifiers: ['ogabassey.com', 'ogabassey'],
      outputDir,
      pdpPath: 'phones/fixture-product',
    });

    expect(
      manifest.captures.map(({ identifier, kind }) => [identifier, kind])
    ).toEqual([
      ['ogabassey.com', 'home'],
      ['ogabassey', 'home'],
      ['ogabassey', 'category'],
      ['ogabassey', 'pdp'],
      ['ogabassey', 'blog'],
      ['cwv-layout-generic-fixture', 'generic'],
    ]);
    expect(manifest.captures[0]?.dependencyFiles).toEqual([
      '/_next/static/chunks/ogabassey.com.js',
      '/_next/static/css/ogabassey.com.css',
    ]);
    expect(manifest.assets).toHaveLength(12);
    expect(
      JSON.parse(
        await readFile(path.join(outputDir, 'capture-manifest.json'), 'utf8')
      )
    ).toEqual(manifest);
  });

  it('rejects a non-loopback capture server before making requests', async () => {
    const outputDir = await mkdtemp(
      path.join(tmpdir(), 'baci-layout-captures-')
    );
    const fetchImpl = vi.fn(async () => htmlResponse('fixture'));
    await expect(
      runOgabasseyLayoutFeasibilityFixture({
        baseUrl: 'https://example.com',
        blogPath: 'blog/post',
        categoryPath: 'phones',
        fetchImpl,
        genericIdentifier: 'generic',
        identifiers: ['ogabassey.com', 'ogabassey'],
        outputDir,
        pdpPath: 'phones/product',
      })
    ).rejects.toThrow(/loopback/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    '../other',
    'phones/%2e%2e/private',
  ])('rejects unsafe route path %s before requests', async (categoryPath) => {
    const outputDir = await mkdtemp(
      path.join(tmpdir(), 'baci-layout-captures-')
    );
    const fetchImpl = vi.fn(async () => htmlResponse('fixture'));
    await expect(
      runOgabasseyLayoutFeasibilityFixture({
        baseUrl: 'http://127.0.0.1:4317',
        blogPath: 'blog/post',
        categoryPath,
        fetchImpl,
        genericIdentifier: 'generic',
        identifiers: ['ogabassey.com', 'ogabassey'],
        outputDir,
        pdpPath: 'phones/product',
      })
    ).rejects.toThrow(/route path/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not follow redirects for captured build assets', async () => {
    const outputDir = await mkdtemp(
      path.join(tmpdir(), 'baci-layout-captures-')
    );
    const fetchImpl = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        const url = new URL(
          typeof input === 'string' || input instanceof URL ? input : input.url
        );
        return url.pathname.startsWith('/_next/')
          ? new Response('asset', { status: 200 })
          : htmlResponse('fixture');
      }
    );
    await runOgabasseyLayoutFeasibilityFixture({
      baseUrl: 'http://127.0.0.1:4317',
      blogPath: 'blog/post',
      categoryPath: 'phones',
      fetchImpl,
      genericIdentifier: 'generic',
      identifiers: ['ogabassey.com', 'ogabassey'],
      outputDir,
      pdpPath: 'phones/product',
    });
    const assetCalls = fetchImpl.mock.calls.filter(([input]) =>
      String(input).includes('/_next/')
    );
    expect(assetCalls.length).toBeGreaterThan(0);
    for (const [, init] of assetCalls) expect(init?.redirect).toBe('manual');
  });

  it.each([
    { identifiers: ['../outside', 'ogabassey'], generic: 'generic' },
    { identifiers: ['ogabassey.com', 'ogabassey'], generic: 'ogabassey' },
  ])('rejects unsafe or overlapping identifiers before fetching', async ({
    identifiers,
    generic,
  }) => {
    const outputDir = await mkdtemp(
      path.join(tmpdir(), 'baci-layout-captures-')
    );
    const fetchImpl = vi.fn(async () => htmlResponse('fixture'));
    await expect(
      runOgabasseyLayoutFeasibilityFixture({
        baseUrl: 'http://127.0.0.1:4317',
        blogPath: 'blog/post',
        categoryPath: 'phones',
        fetchImpl,
        genericIdentifier: generic,
        identifiers,
        outputDir,
        pdpPath: 'phones/product',
      })
    ).rejects.toThrow(/identifier/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a third identifier instead of silently ignoring it', async () => {
    const outputDir = await mkdtemp(
      path.join(tmpdir(), 'baci-layout-captures-')
    );
    await expect(
      runOgabasseyLayoutFeasibilityFixture({
        baseUrl: 'http://127.0.0.1:4317',
        blogPath: 'blog/post',
        categoryPath: 'phones',
        fetchImpl: vi.fn(async () => htmlResponse('fixture')),
        genericIdentifier: 'generic',
        identifiers: ['ogabassey.com', 'ogabassey', 'extra'],
        outputDir,
        pdpPath: 'phones/product',
      })
    ).rejects.toThrow(/exactly two distinct/i);
  });

  it('rejects cross-origin Next asset references rather than rewriting their origin', async () => {
    const outputDir = await mkdtemp(
      path.join(tmpdir(), 'baci-layout-captures-')
    );
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          '<link rel="stylesheet" href="https://other.example/_next/static/css/a.css">',
          { status: 200, headers: { 'content-type': 'text/html' } }
        )
    );
    await expect(
      runOgabasseyLayoutFeasibilityFixture({
        baseUrl: 'http://127.0.0.1:4317',
        blogPath: 'blog/post',
        categoryPath: 'phones',
        fetchImpl,
        genericIdentifier: 'generic',
        identifiers: ['ogabassey.com', 'ogabassey'],
        outputDir,
        pdpPath: 'phones/product',
      })
    ).rejects.toThrow(/cross.origin.*asset/i);
  });

  it('rejects successful responses that are not HTML', async () => {
    const outputDir = await mkdtemp(
      path.join(tmpdir(), 'baci-layout-captures-')
    );
    await expect(
      runOgabasseyLayoutFeasibilityFixture({
        baseUrl: 'http://127.0.0.1:4317',
        blogPath: 'blog/post',
        categoryPath: 'phones',
        fetchImpl: vi.fn(
          async () =>
            new Response('{}', {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
        ),
        genericIdentifier: 'generic',
        identifiers: ['ogabassey.com', 'ogabassey'],
        outputDir,
        pdpPath: 'phones/product',
      })
    ).rejects.toThrow(/html/i);
  });

  it('fails closed when an actual route does not return HTML successfully', async () => {
    const outputDir = await mkdtemp(
      path.join(tmpdir(), 'baci-layout-captures-')
    );

    await expect(
      runOgabasseyLayoutFeasibilityFixture({
        baseUrl: 'http://127.0.0.1:4317',
        blogPath: 'blog/fixture-post',
        categoryPath: 'phones',
        fetchImpl: vi.fn(async () => new Response('missing', { status: 404 })),
        genericIdentifier: 'cwv-layout-generic-fixture',
        identifiers: ['ogabassey.com', 'ogabassey'],
        outputDir,
        pdpPath: 'phones/fixture-product',
      })
    ).rejects.toThrow(/ogabassey\.com.*404/i);
  });
});
