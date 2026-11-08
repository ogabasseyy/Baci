import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const MARKER = 'data-ogabassey-critical-spike="v1"';
export const SENTINEL = '.ogabassey-home-products__eyebrow';
export const HERO_HINT = '/hero-committed.webp';

export async function writeFixture(options?: {
  genericLeaksCriticalFile?: boolean;
  markerAfterBoundary?: boolean;
  missingHeroHint?: boolean;
  heroHintAfterBoundary?: boolean;
  missingGeneratedIdentifier?: boolean;
  negativeMarker?: boolean;
  missingHomeMarker?: boolean;
  missingHomeHint?: boolean;
  mismatchedRawDependency?: boolean;
  extraHomeDependency?: boolean;
  missingKind?: 'category' | 'pdp' | 'blog';
  leakingKind?: 'category' | 'pdp' | 'blog';
}) {
  const root = await mkdtemp(path.join(tmpdir(), 'baci-layout-feasibility-'));
  const nextDir = path.join(root, '.next');
  const captureDir = path.join(root, 'captures');
  const prebuiltDir = path.join(root, 'prebuilt-static');
  await mkdir(path.join(nextDir, 'server', 'app'), { recursive: true });
  await mkdir(path.join(captureDir, 'html'), { recursive: true });
  await mkdir(path.join(captureDir, 'assets'), { recursive: true });

  const routes: Record<string, { srcRoute: string }> = {
    '/ogabassey': { srcRoute: '/[slug]' },
    ...(options?.missingGeneratedIdentifier
      ? {}
      : { '/ogabassey.com': { srcRoute: '/[slug]' } }),
  };
  await writeFile(
    path.join(nextDir, 'prerender-manifest.json'),
    JSON.stringify({ version: 4, routes })
  );

  const hint = `<link rel="preload" as="image" href="${HERO_HINT}">`;
  const staticPrefix = options?.markerAfterBoundary
    ? `<!--$?--><span hidden ${MARKER}></span>`
    : `${!options?.missingHeroHint && !options?.heroHintAfterBoundary ? hint : ''}<span hidden ${MARKER}></span><!--$?-->${options?.heroHintAfterBoundary ? hint : ''}`;
  const rawRefs =
    '<script src="/_next/static/chunks/shared.js"></script><script src="/_next/static/chunks/oga-critical.js"></script><link rel="stylesheet" href="/_next/static/css/oga-critical.css">';
  const mismatched = options?.mismatchedRawDependency
    ? '<script src="/_next/static/chunks/other-build.js"></script>'
    : '';
  for (const identifier of ['ogabassey', 'ogabassey.com']) {
    await writeFile(
      path.join(nextDir, 'server', 'app', `${identifier}.html`),
      `<html><head>${rawRefs}${mismatched}</head><body>${staticPrefix}</body></html>`
    );
  }

  const captures = [
    {
      dependencyFiles: [
        '/_next/static/chunks/shared.js',
        '/_next/static/chunks/oga-critical.js',
        '/_next/static/css/oga-critical.css',
      ],
      htmlPath: 'html/ogabassey-home.html',
      identifier: 'ogabassey',
      kind: 'home',
    },
    {
      dependencyFiles: [
        '/_next/static/chunks/shared.js',
        '/_next/static/chunks/oga-critical.js',
        '/_next/static/css/oga-critical.css',
      ],
      htmlPath: 'html/ogabassey-domain-home.html',
      identifier: 'ogabassey.com',
      kind: 'home',
    },
    ...(['category', 'pdp', 'blog'] as const)
      .filter((kind) => kind !== options?.missingKind)
      .map((kind) => ({
        dependencyFiles: [
          '/_next/static/chunks/shared.js',
          ...(kind === options?.leakingKind
            ? ['/_next/static/css/oga-critical.css']
            : []),
        ],
        htmlPath: `html/ogabassey-${kind}.html`,
        identifier: 'ogabassey',
        kind,
      })),
    {
      dependencyFiles: [
        '/_next/static/chunks/shared.js',
        ...(options?.genericLeaksCriticalFile
          ? [
              '/_next/static/chunks/oga-critical.js',
              '/_next/static/css/oga-critical.css',
            ]
          : [
              '/_next/static/chunks/generic.js',
              '/_next/static/css/generic.css',
            ]),
      ],
      htmlPath: 'html/generic-home.html',
      identifier: 'cwv-layout-generic-fixture',
      kind: 'generic',
    },
  ];
  for (const capture of captures) {
    const marker =
      options?.negativeMarker && capture.kind === 'category'
        ? `<span ${MARKER}></span>`
        : '';
    const homeMarker =
      capture.kind === 'home' && !options?.missingHomeMarker
        ? `<span ${MARKER}></span>`
        : '';
    const homeHint =
      capture.kind === 'home' && !options?.missingHomeHint ? hint : '';
    const refs = capture.dependencyFiles
      .map((dependency) =>
        dependency.endsWith('.css')
          ? `<link rel="stylesheet" href="${dependency}">`
          : `<script src="${dependency}"></script>`
      )
      .join('');
    const extra =
      capture.kind === 'home' && options?.extraHomeDependency
        ? '<script src="/_next/static/chunks/not-captured.js"></script>'
        : '';
    await writeFile(
      path.join(captureDir, capture.htmlPath),
      `<html><head>${homeHint}${refs}${extra}</head><body>${marker}${homeMarker}fixture-${capture.kind}</body></html>`
    );
  }
  await writeFile(
    path.join(captureDir, 'assets', 'oga-critical.css'),
    `${SENTINEL}{color:#ff7377}`
  );
  await writeFile(
    path.join(captureDir, 'assets', 'generic.css'),
    '.generic-home{color:black}'
  );
  await writeFile(
    path.join(captureDir, 'assets', 'oga-critical.js'),
    `export const marker = '${MARKER}'`
  );
  await writeFile(
    path.join(captureDir, 'assets', 'generic.js'),
    'export const generic = true'
  );
  await writeFile(
    path.join(captureDir, 'assets', 'shared.js'),
    'export const shared = true'
  );
  await writeFile(
    path.join(captureDir, 'capture-manifest.json'),
    JSON.stringify({
      assets: [
        {
          path: 'assets/oga-critical.css',
          url: '/_next/static/css/oga-critical.css',
        },
        {
          path: 'assets/generic.css',
          url: '/_next/static/css/generic.css',
        },
        {
          path: 'assets/oga-critical.js',
          url: '/_next/static/chunks/oga-critical.js',
        },
        {
          path: 'assets/generic.js',
          url: '/_next/static/chunks/generic.js',
        },
        {
          path: 'assets/shared.js',
          url: '/_next/static/chunks/shared.js',
        },
      ],
      captures: captures.map((capture) => ({
        ...capture,
        url: `http://127.0.0.1:4317/${capture.identifier}`,
      })),
      version: 1,
    })
  );

  for (const [name, folder] of [
    ['oga-critical.css', 'css'],
    ['generic.css', 'css'],
    ['oga-critical.js', 'chunks'],
    ['generic.js', 'chunks'],
    ['shared.js', 'chunks'],
  ]) {
    const output = path.join(prebuiltDir, '_next', 'static', folder, name);
    await mkdir(path.dirname(output), { recursive: true });
    await copyFile(path.join(captureDir, 'assets', name), output);
  }
  return {
    captureDir,
    nextDir,
    prebuiltDir,
    negativeRouteEvidence: {
      category: 'fixture-category',
      pdp: 'fixture-pdp',
      blog: 'fixture-blog',
      generic: 'fixture-generic',
    },
  };
}
