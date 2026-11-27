import path from 'node:path';
import vm from 'node:vm';
import { build as esbuildBuild } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-catalog-fixture';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';

describe('Round-8 Codex DOM attribute sinks, navigation safety/shapes, CSS comments, and prod entry regressions', () => {
  it.each([
    [
      'iframe.setAttribute("srcdoc", ...)',
      `export default function X() {
         return <button type="button" onClick={(e) => { e.currentTarget.setAttribute('srcdoc', '<b>x</b>'); }}>ok</button>;
       }`,
    ],
    [
      'iframe.setAttributeNS(null, "srcdoc", ...)',
      `export default function X() {
         return <button type="button" onClick={(e) => { e.currentTarget.setAttributeNS(null, 'srcdoc', '<b>x</b>'); }}>ok</button>;
       }`,
    ],
    [
      'document.createAttribute("srcdoc")',
      `export default function X() {
         return <button type="button" onClick={() => { document.createAttribute('srcdoc'); }}>ok</button>;
       }`,
    ],
  ])('blocks attribute-based raw HTML sink: %s', async (_label, code) => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [{ path: 'src/StorefrontApp.tsx', content: code }];
    await expect(compileStorefrontWorker(manifest)).rejects.toBeInstanceOf(
      StorefrontCompilerError
    );
  });

  it('still permits benign product.attributes commerce field reads', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `export default function X() {
          const product = { attributes: { ram: '16GB' } };
          return <main>{product.attributes.ram}</main>;
        }`,
      },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    expect(compiled.workerCode.length).toBeGreaterThan(500);
  });

  it('rejects backslash-prefixed navigation paths and returns declared { presented: boolean } and RouteState shapes', async () => {
    const entrySrc = buildClientHydrationEntrySource('src/App.tsx', {
      'hero-banner': '/assets/hero-banner',
    });
    expect(entrySrc).toContain('resolveSafeInternalPath');
    expect(entrySrc).toContain('presented: true');

    let capturedTransport:
      | ((
          method: string,
          args: Record<string, unknown>
        ) => Promise<{ status: string; value?: unknown; code?: string }>)
      | undefined;

    const assignedUrls: string[] = [];
    const openedUrls: string[] = [];
    const postedMessages: unknown[] = [];

    const stubModuleBody = entrySrc
      .replace(
        "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
        'const CommerceProvider = "CommerceProvider"; const createCommerceClient = (fn) => { __captureTransport(fn); return fn; };'
      )
      .replace(
        "import { createElement } from 'react';",
        'const createElement = () => ({});'
      )
      .replace(
        "import { hydrateRoot } from 'react-dom/client';",
        'const hydrateRoot = () => {};'
      )
      .replace(
        'import StorefrontApp from "./src/App.tsx";',
        'const StorefrontApp = () => null;'
      );

    const windowMock = {
      location: {
        origin: 'https://ogabassey.mybaci.store',
        assign: (u: string) => assignedUrls.push(u),
      },
      parent: null as unknown,
      open: (u: string, target: string) => {
        expect(target).toBe('_blank');
        openedUrls.push(u);
        return { opener: {} };
      },
    };
    windowMock.parent = windowMock;

    vm.runInNewContext(stubModuleBody, {
      URL,
      __captureTransport: (fn: typeof capturedTransport) => {
        capturedTransport = fn;
      },
      window: windowMock,
      document: {
        getElementById: (id: string) =>
          id === 'root'
            ? {}
            : {
                textContent: JSON.stringify({
                  view: 'home',
                  merchantSlug: 'ogabassey',
                }),
              },
      },
    });

    expect(capturedTransport).toBeDefined();
    if (!capturedTransport) throw new Error('Expected transport');

    for (const unsafePath of [
      '/\\evil.example/steal',
      '/.//evil.example/steal',
      '/a/..//evil.example/steal',
    ]) {
      const goRes = await capturedTransport('navigation.go', {
        path: unsafePath,
      });
      expect(goRes).toMatchObject({
        status: 'error',
        code: 'INVALID_REQUEST',
      });
      const openRes = await capturedTransport('navigation.open', {
        path: unsafePath,
      });
      expect(openRes).toMatchObject({
        status: 'error',
        code: 'INVALID_REQUEST',
      });
    }
    expect(assignedUrls).toHaveLength(0);
    expect(openedUrls).toHaveLength(0);

    const validGo = await capturedTransport('navigation.go', {
      path: '/smartphones?brand=Apple',
    });
    expect(validGo).toEqual({
      status: 'ok',
      value: {
        epoch: 1,
        routeId: 'home',
        params: {},
        canonicalPath: '/smartphones?brand=Apple',
        publicDataRevision: '0',
      },
    });
    expect(assignedUrls).toEqual(['/smartphones?brand=Apple']);

    const validOpen = await capturedTransport('navigation.open', {
      path: '/smartphones',
    });
    expect(validOpen).toEqual({ status: 'ok', value: { presented: true } });
    expect(openedUrls).toEqual(['/smartphones']);

    // Framed postMessage branch also returns { presented: true }
    windowMock.parent = {
      postMessage: (msg: unknown) => postedMessages.push(msg),
    };
    const framedOpen = await capturedTransport('navigation.open', {
      path: '/search',
    });
    expect(framedOpen).toEqual({ status: 'ok', value: { presented: true } });
    expect(postedMessages).toHaveLength(1);

    const checkoutOpen = await capturedTransport('checkout.open', {});
    expect(checkoutOpen).toEqual({ status: 'ok', value: { presented: true } });
    expect(assignedUrls.at(-1)).toBe('https://ogabassey.usebaci.com/cart');
  });

  it('ignores commented @import rules in CSS graph while preserving compound selectors and escaped line continuations', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      {
        path: 'theme.css',
        content: '.independent-theme { color: #fedcba; }',
      },
      {
        path: 'main.css',
        content: `/* @import "theme.css"; */\n/* @import "main.css"; */\n.card/*mid*/.selected { border-color: #234567; }\n.foo\\"::before { content: "/* keep-escaped-sel */"; }\n.banner::before { content: "line1\\\n/* keep */"; color: #123456; }`,
      },
      {
        path: 'src/StorefrontApp.tsx',
        content: `export default function App() { return <main className="independent-theme banner card selected">ok</main>; }`,
      },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    expect(compiled.cssCode).toContain('#fedcba');
    expect(compiled.cssCode).toContain('#123456');
    expect(compiled.cssCode).toContain('.card.selected');
    expect(compiled.cssCode).toContain('/* keep-escaped-sel */');
    expect(compiled.cssCode).toContain('/* keep */');
  });

  it('keeps benchmark and miniflare dependencies completely out of the production src/index.ts entry', async () => {
    const pkgRoot = path.resolve(import.meta.dirname, '../..');
    const result = await esbuildBuild({
      entryPoints: [path.join(pkgRoot, 'src/index.ts')],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      external: [
        'esbuild',
        'tailwindcss',
        '@typescript/typescript6',
        'miniflare',
        'workerd',
      ],
    });
    const code = result.outputFiles[0]?.text ?? '';
    expect(code).not.toContain('miniflare');
    expect(code).not.toMatch(/from\s+["'](?:miniflare|workerd)["']/);
    expect(code).not.toContain('runPhase0Benchmarks');
  });
});
