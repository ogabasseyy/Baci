import { expect, it } from 'vitest';
import { fixtureManifest } from '../../tests/experience-browser/fixtures/qualification-fixtures';
import { bundleSource } from './bundle-source';
import { hydrationRuntimeEntry } from './prerender-runtime-entry';

it('compiles an SSR entry without executing merchant modules on the host', async () => {
  const m = fixtureManifest('device-configurator');
  m.files[0].content =
    'throw Error("MERCHANT_MUST_NOT_RUN_ON_HOST"); export default function Store(){return <h1>Custom storefront</h1>}';
  const result = await bundleSource(m, { renderMode: 'prerender' });
  expect(result.javascript).toMatch(/as prerender/);
  expect(result.javascript).toContain('MERCHANT_MUST_NOT_RUN_ON_HOST');
});

it('hydrates real initial markup instead of waiting to create an empty root', async () => {
  const m = fixtureManifest('device-configurator');
  const result = await bundleSource(m, {
    renderMode: 'hydrate',
    hostOrigin: 'http://127.0.0.1:43174',
  });
  expect(result.javascript).toContain('baci-prerender-bootstrap');
  expect(result.javascript).toContain('baci-prerender/v1');
  expect(result.hostOrigin).toBe('http://127.0.0.1:43174');
  expect(result.javascript).toContain('react-commit/v1');
  expect(result.javascript).toContain('acknowledgeRenderCommit');
  expect(result.javascript).toContain('HYDRATION_FAILED');
});

it('opts generated client-only entries into post-commit readiness', async () => {
  const m = fixtureManifest('device-configurator');
  const result = await bundleSource(m, {
    mountComponent: true,
    hostOrigin: 'http://127.0.0.1:43174',
  });

  expect(result.javascript).toContain('react-commit/v1');
  expect(result.javascript).toContain('acknowledgeRenderCommit');
  expect(result.javascript).toContain('HYDRATION_FAILED');
});

it('marks hydrated HTML ready only from a committed bootstrap layout effect', () => {
  const runtime = hydrationRuntimeEntry(
    'Experience.tsx',
    'http://127.0.0.1:43174'
  );
  const commitEffect = runtime.indexOf(
    'useLayoutEffect(()=>{if(!bridgeReady||!data||hydrationFailed)return;'
  );
  const readinessMarker = runtime.indexOf(
    "document.documentElement.dataset.baciHydration='ready'"
  );

  expect(runtime).toContain(JSON.stringify({ readiness: 'react-commit/v1' }));
  expect(runtime).toContain('bridge.acknowledgeRenderCommit(data.route.epoch)');
  expect(runtime).toContain('onRecoverableError:failHydration');
  expect(commitEffect).toBeGreaterThanOrEqual(0);
  expect(readinessMarker).toBeGreaterThan(commitEffect);
});

it('rejects authored collisions with reserved prerender entries', async () => {
  const m = fixtureManifest('device-configurator');
  m.files.push({
    path: '__baci_prerender__.tsx',
    content: 'export default null',
  });
  await expect(bundleSource(m, { renderMode: 'prerender' })).rejects.toThrow(
    'Reserved runtime entry'
  );
});
