import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createPrivatePrerenderDocument } from '../../../../apps/web/src/lib/experience/private-prerender-document';
import {
  fixtureCatalog,
  fixtureManifest,
} from '../../../../apps/web/tests/experience-browser/fixtures/qualification-fixtures';
import { runLocalQualification } from '../../../../apps/web/tools/experience-runner/local-oci-executor';
import { unpackPrerenderBuild } from '../../../../apps/web/tools/experience-runner/prerender-artifacts';
import { packPrivateBuild } from '../../../../apps/web/tools/experience-runner/private-build-payload';

const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const results = [];
for (const name of [
  'editorial-fashion',
  'device-configurator',
  'motion-studio',
]) {
  const manifest = fixtureManifest(name);
  manifest.files.push({
    path: 'src/TestStore.tsx',
    content: `import Experience from './Experience';import {QualificationCommerce} from './qualification-commerce';export default function Store(props){return <QualificationCommerce navigate={()=>{}}><Experience {...props}/></QualificationCommerce>}`,
  });
  manifest.entry = 'src/TestStore.tsx';
  const compiled = unpackPrerenderBuild(
    (
      await runLocalQualification(
        'prerender-build',
        packPrivateBuild(manifest, 'http://localhost:4100')
      )
    ).output
  );
  const bootstrap = {
    route: {
      routeId: 'home',
      epoch: 1,
      canonicalPath: '/',
      params: {},
      publicDataRevision: 'synthetic-1',
    },
    catalog: fixtureCatalog,
    capabilities: ['catalog.read'],
    assets: {},
  };
  const ssr = (
    await runLocalQualification('prerender', {
      javascript: compiled.renderer.javascript,
      bootstrap,
    })
  ).output as { html: string };
  const base = `http://127.0.0.1:4101/resource/${compiled.client.digest}`;
  const html = createPrivatePrerenderDocument(ssr.html, bootstrap, [
    {
      path: 'app.js',
      url: `${base}/app.js`,
      digest: hash(compiled.client.javascript),
    },
    {
      path: 'app.css',
      url: `${base}/app.css`,
      digest: hash(compiled.client.css),
    },
  ]);
  for (const width of [390, 1440]) {
    const receipt = await runLocalQualification('performance', {
      mode: 'candidate-performance/v1',
      width,
      bundle: compiled.client,
      html,
      bootstrap,
      assets: [],
    });
    results.push({ name, width, receipt });
    console.log(JSON.stringify({ name, width, receipt }));
    writeFileSync(
      '.superpowers/sdd/2026-10-27-experience-root/native-three-stores.json',
      JSON.stringify(
        {
          diagnosticOnly: true,
          main: 'de0e4a5f2fab01aa06964293d0c713fbea07ae6b',
          results,
        },
        null,
        2
      )
    );
  }
}
