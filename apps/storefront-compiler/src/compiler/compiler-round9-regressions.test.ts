import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createOgabasseyStorefrontManifest } from '../benchmark/ogabassey-catalog-fixture';
import { parseWorkerStorefrontManifest } from '../schemas/worker-manifest';
import { buildClientHydrationEntrySource } from './client-hydration-template';
import {
  compileStorefrontWorker,
  StorefrontCompilerError,
} from './compile-storefront';
import { buildContentSecurityPolicyHeader } from './csp-header';

describe('Round-9 Codex Object.assign, CSP wildcard, popup presented, and route normalization', () => {
  it.each([
    [
      'Object.assign DOM raw-HTML write',
      `export default function X() {
         return <button type="button" onClick={() => { Object.assign(document.body, JSON.parse('{"innerHTML":"<b>x</b>"}')); }}>ok</button>;
       }`,
    ],
    [
      'Object.assign alias destructuring',
      `export default function X() {
         const { assign } = Object;
         return <p>{String(Boolean(assign))}</p>;
       }`,
    ],
    [
      'document.createElementNS script injection',
      `export default function X() {
         return <button type="button" onClick={() => { document.createElementNS('http://www.w3.org/1999/xhtml', 'script'); }}>ok</button>;
       }`,
    ],
    [
      'JSX <script> element',
      `export default function X() {
         return <script>{'alert(1)'}</script>;
       }`,
    ],
  ])('blocks indirect DOM/HTML injection: %s', async (_label, code) => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [{ path: 'src/StorefrontApp.tsx', content: code }];
    await expect(compileStorefrontWorker(manifest)).rejects.toBeInstanceOf(
      StorefrontCompilerError
    );
  });

  it('allows safe spread-free Object.assign({}, { ... }) and benign { assign } labels', async () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.files = [
      {
        path: 'src/StorefrontApp.tsx',
        content: `export default function X() {
          const merged = Object.assign({}, { mode: 'grid' });
          const labels = JSON.stringify({ assign: 'Assign serial' });
          return <main>{merged.mode}:{labels}</main>;
        }`,
      },
    ];
    const compiled = await compileStorefrontWorker(manifest);
    expect(compiled.workerCode.length).toBeGreaterThan(500);
  });

  it('emits zero wildcards in CSP img-src and form-action when manifest declares no extra origins', () => {
    const manifest = createOgabasseyStorefrontManifest();
    manifest.cspAllowlist = {
      scriptOrigins: [],
      connectOrigins: [],
      imgOrigins: [],
    };
    const csp = buildContentSecurityPolicyHeader(manifest);
    expect(csp).not.toContain('supabase.co');
    expect(csp).not.toContain('*');
    expect(csp).toContain('https://ogabassey.usebaci.com');
  });

  it('reports { presented: false } when window.open is popup-blocked and { presented: true } with opener severed when allowed', async () => {
    const entrySrc = buildClientHydrationEntrySource('src/App.tsx', {});
    let capturedTransport:
      | ((
          method: string,
          args: Record<string, unknown>
        ) => Promise<{ status: string; value?: unknown }>)
      | undefined;

    let popupBlocked = false;
    const openedHandle: { opener: unknown } = { opener: { secret: 1 } };

    const stubBody = entrySrc
      .replace(
        "import { CommerceProvider, createCommerceClient } from '@baci/experience-sdk';",
        'const CommerceProvider = "CommerceProvider"; const createCommerceClient = (fn) => { __capture(fn); return fn; };'
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

    const winMock = {
      location: {
        origin: 'https://ogabassey.mybaci.store',
        assign: () => {},
      },
      parent: null as unknown,
      open: () => (popupBlocked ? null : openedHandle),
    };
    winMock.parent = winMock;

    vm.runInNewContext(stubBody, {
      URL,
      __capture: (fn: typeof capturedTransport) => {
        capturedTransport = fn;
      },
      window: winMock,
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

    if (!capturedTransport) throw new Error('Expected transport');

    const allowed = await capturedTransport('navigation.open', {
      path: '/smartphones',
    });
    expect(allowed).toEqual({ status: 'ok', value: { presented: true } });
    expect(openedHandle.opener).toBeNull();

    popupBlocked = true;
    const blocked = await capturedTransport('navigation.open', {
      path: '/smartphones',
    });
    expect(blocked).toEqual({ status: 'ok', value: { presented: false } });
  });

  it('rejects routes that normalize to the same matcher pattern and non-executable entry paths', () => {
    const trailingDup = createOgabasseyStorefrontManifest();
    trailingDup.routes.push({ path: '/cart/', view: 'editorial' });
    expect(() => parseWorkerStorefrontManifest(trailingDup)).toThrow(
      /Duplicate normalized route pattern/
    );

    const dynamicDup = createOgabasseyStorefrontManifest();
    dynamicDup.routes.push({ path: '/:slug', view: 'editorial' });
    expect(() => parseWorkerStorefrontManifest(dynamicDup)).toThrow(
      /Duplicate normalized route pattern/
    );

    const bracketDup = createOgabasseyStorefrontManifest();
    bracketDup.routes.push({ path: '/[handle]', view: 'editorial' });
    expect(() => parseWorkerStorefrontManifest(bracketDup)).toThrow(
      /Duplicate normalized route pattern/
    );

    const cssEntry = createOgabasseyStorefrontManifest();
    cssEntry.files.push({
      path: 'src/only.css',
      content: '.a { color: red; }',
    });
    cssEntry.entry = 'src/only.css';
    expect(() => parseWorkerStorefrontManifest(cssEntry)).toThrow(/executable/);
  });
});
