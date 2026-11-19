import { describe, expect, it } from 'vitest';
import { fixtureManifest } from '../../tests/experience-browser/fixtures/qualification-fixtures';
import { bundleSource } from './bundle-source';

describe('offline static compilation', () => {
  it('compiles full source deterministically without executing its module', async () => {
    const m = fixtureManifest('device-configurator');
    m.files[0].content =
      'throw new Error("MUST_NOT_EXECUTE"); export default function Custom(){return <div>Custom</div>}';
    const a = await bundleSource(m);
    const b = await bundleSource(m);
    expect(a.digest).toBe(b.digest);
    expect(a.javascript).toContain('MUST_NOT_EXECUTE');
  });
  it('rejects_unlisted_transitive_import and source-selected host files', async () => {
    const m = fixtureManifest('device-configurator');
    m.files[0].content =
      'import "./hidden"; export default function X(){return null}';
    m.files.push({ path: 'src/hidden.ts', content: 'import "node:fs";' });
    await expect(bundleSource(m)).rejects.toThrow();
    m.files[0].content =
      'import "/etc/passwd"; export default function X(){return null}';
    await expect(bundleSource(m)).rejects.toThrow();
    m.files[0].content =
      'import "https://provider.invalid/model"; export default function X(){return null}';
    await expect(bundleSource(m)).rejects.toThrow();
  });
  it('resolves only declared offline CSS image/font URLs without fetching or filesystem access', async () => {
    const manifest = fixtureManifest('device-configurator');
    manifest.assets = [
      { assetId: 'synthetic-image', alt: 'Synthetic image' },
      { assetId: 'synthetic-font', alt: 'Synthetic font' },
    ];
    const css = manifest.files.find((f) => f.path.endsWith('.css'));
    if (!css) throw Error('Missing fixture CSS');
    css.content +=
      '\n.probe{background-image:url("/assets/synthetic-image")}@font-face{font-family:Offline;src:url("/assets/synthetic-font")}';
    const output = await bundleSource(manifest);
    expect(output.css).toContain('/assets/synthetic-image');
    expect(output.css).toContain('/assets/synthetic-font');
    css.content += ' .bad{background:url("/assets/undeclared")}';
    await expect(bundleSource(manifest)).rejects.toThrow();
  });
  it.each([
    'editorial-fashion',
    'device-configurator',
    'motion-studio',
  ])('bundles authored helpers, hooks and pinned packages in %s', async (name) => {
    const output = await bundleSource(fixtureManifest(name));
    expect(output.javascript.length).toBeGreaterThan(100);
    expect(output.css.length).toBeGreaterThan(0);
    expect(output.imports.every((i) => !i.startsWith('http'))).toBe(true);
  });
});

it('bundles the browser-only workspace SDK with one platform React instance', async () => {
  const manifest = {
    format: 'baci.experience/v2',
    runtime: 'react-browser-sandbox/v1',
    sdkVersion: 'commerce-bridge/v1',
    entry: 'app.tsx',
    files: [
      {
        path: 'app.tsx',
        content:
          "import {createCommerceClient} from '@baci/experience-sdk'; export const api=createCommerceClient(async()=>({status:'error',code:'NOT_FOUND',message:'synthetic'}));",
      },
    ],
    packages: [{ name: '@baci/experience-sdk', versionRef: 'platform-pinned' }],
    routes: [{ path: '/', view: 'home' }],
    assets: [],
    capabilities: [],
  };
  const result = await bundleSource(manifest as never);
  expect(result.javascript).toContain('synthetic');
  expect(
    result.imports.some((p) => p.includes('supabase') || p.includes('/ai/'))
  ).toBe(false);
});
it('mounts an ordinary default component through the platform SDK without source edits', async () => {
  const manifest = {
    format: 'baci.experience/v2',
    runtime: 'react-browser-sandbox/v1',
    sdkVersion: 'commerce-bridge/v1',
    entry: 'app.tsx',
    files: [
      {
        path: 'app.tsx',
        content:
          'export default function App(){return <h1>Ordinary custom component</h1>}',
      },
    ],
    packages: [],
    routes: [{ path: '/', view: 'home' }],
    assets: [],
    capabilities: [],
  };
  const result = await bundleSource(manifest as never, {
    mountComponent: true,
  });
  expect(result.javascript).toContain('baci-experience-connect');
  expect(result.javascript).toContain('Ordinary custom component');
});
it('binds the SDK to the explicitly trusted local preview parent origin', async () => {
  const manifest = {
    format: 'baci.experience/v2',
    runtime: 'react-browser-sandbox/v1',
    sdkVersion: 'commerce-bridge/v1',
    entry: 'app.tsx',
    files: [
      {
        path: 'app.tsx',
        content:
          'export default function App(){return <h1>Configured origin</h1>}',
      },
    ],
    packages: [],
    routes: [{ path: '/', view: 'home' }],
    assets: [],
    capabilities: [],
  };
  const result = await bundleSource(manifest as never, {
    mountComponent: true,
    hostOrigin: 'http://127.0.0.1:4102',
  });
  expect(result.javascript).toContain('http://127.0.0.1:4102');
  expect(result.javascript).not.toContain('http://127.0.0.1:4100');
});
