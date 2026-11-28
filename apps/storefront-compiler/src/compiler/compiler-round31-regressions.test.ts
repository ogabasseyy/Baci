import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-storefront-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round 31 compiler & runtime regressions', () => {
  it('rejects native HTML form action/formAction and uncontrolled <form> without onSubmit while permitting React onSubmit forms', async () => {
    const invalidForms = [
      `export default function X() { return <form action="/search"><input name="q" /><button type="submit">Go</button></form>; }`,
      `export default function X() { return <form onSubmit={(e) => e.preventDefault()}><button type="submit" formAction="/search">Go</button></form>; }`,
      `export default function X() { return <form><input name="q" /><button type="submit">Go</button></form>; }`,
      `export default function X() { const h = (e: any) => e.preventDefault(); return <form onSubmit={h} {...{ onSubmit: undefined }}><button type="submit">Go</button></form>; }`,
    ];

    for (const content of invalidForms) {
      const manifest = createOgabasseyStorefrontManifest();
      manifest.files = [{ path: 'src/StorefrontApp.tsx', content }];
      await expect(compileStorefrontWorker(manifest)).rejects.toThrow(
        StorefrontCompilerError
      );
    }

    const validManifest = createOgabasseyStorefrontManifest();
    validManifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `
          import { useState } from 'react';
          export default function StorefrontApp() {
            const [q, setQ] = useState('');
            return (
              <form role="search" onSubmit={(e) => { e.preventDefault(); }}>
                <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search devices" />
                <button type="submit">Filter</button>
              </form>
            );
          }
        `,
      },
    ];
    const compiled = await compileStorefrontWorker(validManifest);
    expect(compiled.workerCode.length).toBeGreaterThan(100);
  });

  it('serializes concurrent framed navigation.go calls and advances routeEpoch before dispatching the queued transition', async () => {
    const entrySrc = buildClientHydrationEntrySource('src/App.tsx', {}, [
      { path: '/', view: 'home' },
      { path: '/smartphones', view: 'collection' },
      { path: '/laptops', view: 'collection' },
    ]);

    let capturedTransport:
      | ((
          method: string,
          args: Record<string, unknown>
        ) => Promise<{ status: string; value?: unknown }>)
      | undefined;
    let messageListener: ((event: unknown) => void) | undefined;
    const parentFrame = {};

    const stubBody = entrySrc
      .replace(
        "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
        'const CommerceProvider = (p) => p.children; const createCommerceClient = (fn) => { __capture(fn); return fn; };'
      )
      .replace(
        "import { createElement, useEffect } from 'react';",
        'const createElement = () => ({}); const useEffect = () => {};'
      )
      .replace(
        "import { hydrateRoot } from 'react-dom/client';",
        'const hydrateRoot = () => ({ render: () => {} });'
      )
      .replace(
        'const mod = await import("./src/App.tsx");',
        'const mod = { default: () => null };'
      );

    vm.runInNewContext(stubBody, {
      URL,
      URLSearchParams,
      __capture: (fn: typeof capturedTransport) => {
        capturedTransport = fn;
      },
      window: {
        location: { origin: 'null', assign: () => {} },
        parent: parentFrame,
        addEventListener: (t: string, cb: (ev: unknown) => void) => {
          if (t === 'message') messageListener = cb;
        },
        removeEventListener: () => {},
      },
      document: {
        getElementById: (id: string) =>
          id === 'root'
            ? { addEventListener: () => {} }
            : {
                textContent:
                  '{"view":"home","pathname":"/","merchantSlug":"ogabassey","publicDataRevision":"1:1"}',
              },
      },
    });
    await new Promise((r) => setImmediate(r));
    if (!capturedTransport || !messageListener)
      throw new Error('Expected transport and listener');

    const sentNavs: Record<string, unknown>[] = [];
    const mockPort: {
      onmessage: ((e: { data: unknown }) => void) | null;
      start: () => void;
      postMessage: (msg: Record<string, unknown>) => void;
    } = {
      onmessage: null,
      start: () => {},
      postMessage: (msg) => {
        if (
          msg.protocol === 'baci-commerce/1' &&
          msg.method === 'navigation.go'
        ) {
          sentNavs.push(msg);
        }
      },
    };

    messageListener({
      source: parentFrame,
      origin: 'https://usebaci.com',
      data: {
        type: 'baci-experience-connect',
        nonce: 'n-31',
        instanceId: 'inst-31',
        buildDigest: 'c'.repeat(64),
      },
      ports: [mockPort],
    });

    // Fire two concurrent navigation.go requests BEFORE the first settles
    const nav1 = capturedTransport('navigation.go', { path: '/smartphones' });
    const nav2 = capturedTransport('navigation.go', { path: '/laptops' });
    await new Promise((r) => setImmediate(r));

    // Only the first navigation.go has been sent over the MessagePort!
    expect(sentNavs).toHaveLength(1);
    expect(sentNavs[0]).toMatchObject({
      routeEpoch: 1,
      args: { path: '/smartphones' },
    });

    // Settle the first navigation at epoch 2
    mockPort.onmessage?.({
      data: {
        type: 'result',
        requestId: sentNavs[0]?.requestId,
        result: {
          status: 'ok',
          value: {
            epoch: 2,
            routeId: 'collection',
            params: { category: 'smartphones' },
            canonicalPath: '/smartphones',
            publicDataRevision: '2:1',
          },
        },
      },
    });
    await expect(nav1).resolves.toMatchObject({
      status: 'ok',
      value: { epoch: 2 },
    });
    await new Promise((r) => setImmediate(r));

    // Now the second navigation.go is sent with the updated routeEpoch: 2!
    expect(sentNavs).toHaveLength(2);
    expect(sentNavs[1]).toMatchObject({
      routeEpoch: 2,
      args: { path: '/laptops' },
    });

    mockPort.onmessage?.({
      data: {
        type: 'result',
        requestId: sentNavs[1]?.requestId,
        result: {
          status: 'ok',
          value: {
            epoch: 3,
            routeId: 'collection',
            params: { category: 'laptops' },
            canonicalPath: '/laptops',
            publicDataRevision: '3:1',
          },
        },
      },
    });
    await expect(nav2).resolves.toMatchObject({
      status: 'ok',
      value: { epoch: 3, canonicalPath: '/laptops' },
    });

    // Excess concurrent navigation.go backlog (> 16) is bounded with QUOTA_EXCEEDED
    const callTransport = capturedTransport;
    const flood = Array.from({ length: 17 }, () =>
      callTransport('navigation.go', { path: '/smartphones' })
    );
    await expect(flood[16]).resolves.toMatchObject({
      status: 'error',
      code: 'QUOTA_EXCEEDED',
    });
  });
});
