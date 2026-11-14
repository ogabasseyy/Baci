/** Trusted local qualification setup; no installs or authored execution. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertLocalQualificationHost } from './local-prerequisites.mjs';

assertLocalQualificationHost();

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.resolve(
  app,
  '../../.superpowers/sdd/2026-10-23-full-code-experiences'
);
const root = '/var/tmp/baci-experience-checkpoint-a';
const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8' };
for (const profile of ['node24', 'browser'])
  execFileSync(
    'colima',
    [
      'ssh',
      '--',
      'sudo',
      'test',
      '-d',
      `${root}/${profile}/rootfs/opt/experience`,
    ],
    { env }
  );
mkdirSync(scratch, { recursive: true });
for (const [source, target, external] of [
  [
    'tools/experience-runner/performance-worker.ts',
    'performance-worker.mjs',
    ['playwright-core'],
  ],
  [
    'tests/experience-browser/interaction-worker.ts',
    'capture-worker.mjs',
    ['playwright-core', 'react', 'react-dom/server'],
  ],
  [
    'tests/experience-browser/browser-checks.ts',
    'browser-checks.mjs',
    ['playwright-core', 'react', 'react-dom/server'],
  ],
  [
    'tools/experience-runner/bundle-source.ts',
    'bundle-source.mjs',
    ['esbuild'],
  ],
  [
    'tools/experience-runner/bundle-source.ts',
    'bundle-source-prerender.mjs',
    ['esbuild'],
  ],
]) {
  await build({
    entryPoints: [path.join(app, source)],
    outfile: path.join(scratch, target),
    bundle: true,
    platform: 'node',
    format: 'esm',
    external,
    logLevel: 'silent',
  });
}
execFileSync(
  'colima',
  [
    'ssh',
    '--',
    'sudo',
    'cp',
    path.join(scratch, 'capture-worker.mjs'),
    `${root}/browser/rootfs/opt/experience/capture-worker.mjs`,
  ],
  { env }
);
execFileSync(
  'colima',
  [
    'ssh',
    '--',
    'sudo',
    'cp',
    path.join(scratch, 'performance-worker.mjs'),
    `${root}/browser/rootfs/opt/experience/performance-worker.mjs`,
  ],
  { env }
);
const compiler = path.join(app, 'tests/experience-browser/compile-worker.mjs');
execFileSync(
  'colima',
  [
    'ssh',
    '--',
    'sudo',
    'cp',
    compiler,
    `${root}/node24/rootfs/opt/experience/compile-runtime.mjs`,
  ],
  { env }
);
execFileSync(
  'colima',
  [
    'ssh',
    '--',
    'sudo',
    'cp',
    path.join(scratch, 'bundle-source.mjs'),
    `${root}/node24/rootfs/opt/experience/tools/experience-runner/bundle-source.mjs`,
  ],
  { env }
);
execFileSync(
  'colima',
  [
    'ssh',
    '--',
    'sudo',
    'cp',
    path.join(scratch, 'browser-checks.mjs'),
    `${root}/browser/rootfs/opt/experience/browser-checks.mjs`,
  ],
  { env }
);
for (const [source, target] of [
  [
    'tools/experience-runner/prerender-build-worker.mjs',
    'prerender-build-worker.mjs',
  ],
  ['tests/experience-performance/prerender-worker.mjs', 'prerender-worker.mjs'],
  ['tests/experience-performance/bounded-input.mjs', 'bounded-input.mjs'],
])
  execFileSync(
    'colima',
    [
      'ssh',
      '--',
      'sudo',
      'cp',
      path.join(app, source),
      `${root}/node24/rootfs/opt/experience/${target}`,
    ],
    { env }
  );
execFileSync(
  'colima',
  [
    'ssh',
    '--',
    'sudo',
    'cp',
    path.join(scratch, 'bundle-source-prerender.mjs'),
    `${root}/node24/rootfs/opt/experience/tools/experience-runner/bundle-source-prerender.mjs`,
  ],
  { env }
);
const workerFiles = [
  ...[
    'browser-checks.mjs',
    'bundle-source.mjs',
    'bundle-source-prerender.mjs',
    'capture-worker.mjs',
    'performance-worker.mjs',
  ].map((name) => [name, path.join(scratch, name)]),
  ['compile-runtime.mjs', compiler],
  ...[
    'tools/experience-runner/prerender-build-worker.mjs',
    'tests/experience-performance/prerender-worker.mjs',
    'tests/experience-performance/bounded-input.mjs',
  ].map((source) => [path.basename(source), path.join(app, source)]),
];
const identity = Object.fromEntries(
  workerFiles.map(([name, file]) => [
    name,
    createHash('sha256').update(readFileSync(file)).digest('hex'),
  ])
);
writeFileSync(
  path.join(scratch, 'remaining-worker-digests.json'),
  `${JSON.stringify(identity, null, 2)}\n`
);
console.log(
  'Prepared pinned local qualification workers; no network/install/provisioning performed.'
);

// Checkpoint B trusted host shell and locked workspace browser SDK. No authored evaluation.
await build({
  entryPoints: [
    path.join(app, 'tests/experience-browser/checkpoint-b-host.tsx'),
  ],
  outfile: path.join(scratch, 'checkpoint-b-host.js'),
  bundle: true,
  platform: 'browser',
  format: 'esm',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  logLevel: 'silent',
});
execFileSync(
  'colima',
  [
    'ssh',
    '--',
    'sudo',
    'cp',
    path.join(scratch, 'checkpoint-b-host.js'),
    `${root}/browser/rootfs/opt/experience/checkpoint-b-host.js`,
  ],
  { env }
);
const platformFiles = [];
for (const [packageName, relative] of [
  ['experience-sdk', 'src'],
  ['shared', 'src/experience'],
]) {
  const packageRoot = path.resolve(app, '../../packages', packageName);
  for (const file of [
    path.join(packageRoot, 'package.json'),
    ...readdirSync(path.join(packageRoot, relative))
      .sort()
      .filter((n) => /\.tsx?$/.test(n) && !n.includes('.test.'))
      .map((n) => path.join(packageRoot, relative, n)),
  ])
    platformFiles.push({
      path: `${packageName}/${path.relative(packageRoot, file)}`,
      content: readFileSync(file, 'utf8'),
    });
}
execFileSync(
  'colima',
  [
    'ssh',
    '--',
    'sudo',
    'python3',
    '-c',
    `import json,pathlib,sys
base=pathlib.Path('${root}/node24/rootfs/opt/experience')
for f in json.load(sys.stdin):
 p=base/'workspace/packages'/f['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_text(f['content'])
for name in ['experience-sdk','shared']:
 p=base/'node_modules/@baci'/name;p.parent.mkdir(parents=True,exist_ok=True)
 if not p.exists():p.symlink_to('../../workspace/packages/'+name)
`,
  ],
  { env, input: JSON.stringify(platformFiles) }
);

const sha = (value) => createHash('sha256').update(value).digest('hex');
const profile = {
  workers: identity,
  hostShell: sha(readFileSync(path.join(scratch, 'checkpoint-b-host.js'))),
  platformFiles: sha(JSON.stringify(platformFiles)),
  policy: sha(
    [
      'tools/experience-runner/oci-policy.ts',
      'tools/experience-runner/local-oci-executor.ts',
    ]
      .map((f) => readFileSync(path.join(app, f), 'utf8'))
      .join('\0')
  ),
  compilerNode: '24.21.0',
  captureNode: '24.20.0',
  playwright: '1.63.0',
  browserManifest:
    'sha256:a0f4498920a5dbac63196d9140ed738ef00470f27e2e74029abd8850b7bd5717',
  runsc: 'release-20261019.0',
};
writeFileSync(
  path.join(scratch, 'checkpoint-b-toolchain.json'),
  `${JSON.stringify({ digest: sha(JSON.stringify(profile)), profile }, null, 2)}\n`
);
