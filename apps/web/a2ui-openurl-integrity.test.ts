/** @vitest-environment node */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Regression coverage for CVE-2026-10032: `@a2ui/web_core` `openUrl` permitted
// `javascript:` URI execution via agent-supplied button actions. Fixed in
// 0.10.2 (see the `pnpm-workspace.yaml` override). This mirrors the upstream
// package's own openUrl test through the installed dependency so a future
// override downgrade fails loudly instead of silently reintroducing the XSS.

const require = createRequire(import.meta.url);
// Resolve through an exported subpath (the package's `exports` map hides
// `./package.json`): `@a2ui/web_core/v0_9` -> `<root>/src/v0_9/index.js`.
const webCoreEntry = require.resolve('@a2ui/web_core/v0_9');
const resolvedRoot = dirname(dirname(dirname(webCoreEntry)));
// Verification hook only: point at an unpacked @a2ui/web_core tarball to
// confirm this test fails on pre-fix releases. Unset in normal runs.
const webCoreRoot = process.env.A2UI_WEB_CORE_ROOT ?? resolvedRoot;
const webCorePackageJsonPath = join(webCoreRoot, 'package.json');

// First release containing the openUrl protocol allowlist.
const FIRST_FIXED = [0, 10, 2] as const;

function parseVersion(version: string): [number, number, number] {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    throw new Error(`Unexpected @a2ui/web_core version: ${version}`);
  }
  return parts as [number, number, number];
}

function isAtLeast(
  actual: [number, number, number],
  minimum: readonly [number, number, number]
): boolean {
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== minimum[index]) {
      return actual[index] > minimum[index];
    }
  }
  return true;
}

interface TestCatalog {
  invoker: (
    name: string,
    args: Record<string, unknown>,
    context: unknown
  ) => unknown;
}

interface CatalogConstructor {
  new (id: string, components: unknown[], functions: unknown[]): TestCatalog;
}

interface DataModelConstructor {
  new (initialData?: Record<string, unknown>): unknown;
}

interface DataContextConstructor {
  new (surface: unknown, path: string): unknown;
}

async function loadWebCore() {
  // NOTE: these deep imports intentionally bypass the package's `exports`
  // map, which exposes only the v0_8/v0_9 entry points — the openUrl
  // implementation is not reachable through the public surface. This couples
  // the test to web_core's internal file layout: if a future release
  // restructures these paths, the import fails loudly (fail-closed) and this
  // test must be updated alongside the override bump.
  const moduleUrl = (relativePath: string): string =>
    pathToFileURL(join(webCoreRoot, relativePath)).href;
  const [functionsModule, dataModelModule, dataContextModule, catalogModule] =
    (await Promise.all([
      import(moduleUrl('src/v0_9/basic_catalog/functions/basic_functions.js')),
      import(moduleUrl('src/v0_9/state/data-model.js')),
      import(moduleUrl('src/v0_9/rendering/data-context.js')),
      import(moduleUrl('src/v0_9/catalog/types.js')),
    ])) as [
      { BASIC_FUNCTIONS: unknown[] },
      { DataModel: DataModelConstructor },
      { DataContext: DataContextConstructor },
      { Catalog: CatalogConstructor },
    ];
  return { functionsModule, dataModelModule, dataContextModule, catalogModule };
}

describe('@a2ui/web_core openUrl integrity (CVE-2026-10032)', () => {
  it('resolves a web_core release containing the openUrl fix', () => {
    const webCorePackage = JSON.parse(
      readFileSync(webCorePackageJsonPath, 'utf8')
    ) as { version?: string };
    expect(typeof webCorePackage.version).toBe('string');
    const actual = parseVersion(webCorePackage.version as string);
    expect(isAtLeast(actual, FIRST_FIXED)).toBe(true);
  });

  it('rejects javascript: and other non-http(s) action URLs', async () => {
    const {
      functionsModule,
      dataModelModule,
      dataContextModule,
      catalogModule,
    } = await loadWebCore();
    const catalog = new catalogModule.Catalog(
      'integrity',
      [],
      functionsModule.BASIC_FUNCTIONS
    );
    const model = new dataModelModule.DataModel({});
    const context = new dataContextModule.DataContext(
      {
        dataModel: model,
        catalog: { invoker: catalog.invoker },
        dispatchError: () => {},
      },
      '/'
    );

    const globalRef = globalThis as unknown as { window?: unknown };
    const originalWindow = globalRef.window;
    let openedUrl = '';
    let openedSpecs = '';
    globalRef.window = {
      location: { href: 'https://example.com/sub/page' },
      open: (url: string, _target: string, specs: string) => {
        openedUrl = url;
        openedSpecs = specs;
      },
    };
    try {
      const maliciousInputs = [
        'javascript:alert(document.domain)',
        '  javascript:alert(1)',
        'javascript://%0Aalert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox("hello")',
        'file:///etc/passwd',
      ];
      for (const input of maliciousInputs) {
        openedUrl = '';
        let thrown: unknown;
        try {
          catalog.invoker('openUrl', { url: input }, context);
        } catch (error) {
          thrown = error;
        }
        // Security property: the URL is rejected (throws) and never
        // opened. Deliberately not asserting the exact upstream error
        // wording so a message reword that keeps the allowlist stays green.
        expect(thrown instanceof Error, `Expected "${input}" to throw`).toBe(
          true
        );
        expect(openedUrl).toBe('');
      }

      catalog.invoker('openUrl', { url: 'https://example.com/' }, context);
      expect(openedUrl).toBe('https://example.com/');
      expect(openedSpecs).toBe('noopener,noreferrer');
    } finally {
      globalRef.window = originalWindow;
    }
  });
});
