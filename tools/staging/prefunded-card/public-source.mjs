import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const entries = [
  'apps/web/src/app/api/storefront/customer/savings/card-checkout/route.ts',
  'apps/web/src/app/api/csrf/route.ts',
  'apps/web/src/app/savings/card-return/page.tsx',
];
const digest = (content) => createHash('sha256').update(content).digest('hex');
const toolsDirectory = path.dirname(fileURLToPath(import.meta.url));

export function assertRetirementSourceClosure(contents) {
  const required = [
    ['apps/web/src/lib/piggyvest/prefunded-card-checkout-public-runtime.ts', 'prefundedCardCheckoutEmailSchema'],
    ['apps/web/src/schemas/prefunded-card-checkout-email.ts', 'public domain'],
    ['apps/web/src/schemas/prefunded-card-checkout-public-runtime.ts', "'retired_unconfirmed'"],
  ];
  for (const [name, marker] of required) {
    const content = contents.get(name);
    if (!content || !content.toString().includes(marker))
      throw new Error('Required first-card retirement source is missing');
  }
}

export async function snapshot(sourceRoot, outputDirectory) {
  const root = path.resolve(sourceRoot);
  const destination = path.resolve(outputDirectory);
  const compilerOptions = {
    target: 'ES2022',
    lib: ['dom', 'dom.iterable', 'esnext'],
    allowJs: true,
    skipLibCheck: true,
    strict: true,
    noEmit: true,
    esModuleInterop: true,
    module: 'esnext',
    moduleResolution: 'bundler',
    resolveJsonModule: true,
    isolatedModules: true,
    jsx: 'react-jsx',
    paths: {
      '@/*': ['./src/*'],
      '@baci/shared/*': ['../../packages/shared/src/*'],
    },
    plugins: [{ name: 'next' }],
  };
  const graph = await build({
    absWorkingDir: root,
    entryPoints: entries,
    bundle: true,
    platform: 'node',
    packages: 'external',
    format: 'esm',
    outdir: 'unused-output',
    write: false,
    metafile: true,
    logLevel: 'silent',
    tsconfigRaw: {
      compilerOptions: { ...compilerOptions, baseUrl: './apps/web' },
    },
  });
  const contents = new Map();
  const sourceHashes = new Map();
  const pending = [...Object.keys(graph.metafile.inputs)];
  const resolutionOptions = {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: path.join(root, 'apps/web'),
    paths: compilerOptions.paths,
  };
  for (const relative of pending) {
    if (contents.has(relative)) continue;
    if (
      !/^(apps\/web\/src\/|packages\/shared\/src\/)/.test(relative) ||
      relative.split('/').includes('..') ||
      /(?:^|\/)\.env/.test(relative) ||
      /(?:^|\/)(?:proxy|middleware)\.[cm]?[jt]sx?$/.test(relative) ||
      /\.(test|spec|fixture)\./.test(relative)
    ) {
      throw new Error('Unapproved checkout source dependency');
    }
    const source = path.join(root, relative);
    const metadata = await lstat(source);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      throw new Error('Source is not a regular file');
    const content = await readFile(source);
    contents.set(relative, content);
    sourceHashes.set(relative, digest(content));
    for (const imported of ts.preProcessFile(content.toString(), true, true)
      .importedFiles) {
      const resolved = ts.resolveModuleName(
        imported.fileName,
        source,
        resolutionOptions,
        ts.sys
      ).resolvedModule;
      if (resolved && !resolved.isExternalLibraryImport) {
        pending.push(path.relative(root, resolved.resolvedFileName));
      }
    }
  }
  for (const entry of entries) {
    if (!contents.has(entry)) throw new Error('Checkout entrypoint missing');
  }
  for (const [name, content] of contents) {
    if (!content.includes("'@/env'") && !content.includes('"@/env"')) continue;
    contents.set(
      name,
      Buffer.from(
        content
          .toString()
          .replaceAll("'@/env'", "'@/public-env'")
          .replaceAll('"@/env"', '"@/public-env"')
      )
    );
  }
  contents.delete('apps/web/src/env.ts');
  sourceHashes.delete('apps/web/src/env.ts');
  assertRetirementSourceClosure(contents);
  const sources = Object.fromEntries(
    sourceHashes
  );
  contents.set(
    'apps/web/next.config.mjs',
    await readFile(path.join(toolsDirectory, 'public-next.config.mjs'))
  );
  contents.set(
    'package.json',
    JSON.stringify({ private: true, name: 'baci-first-card-build' })
  );
  contents.set(
    'apps/web/package.json',
    JSON.stringify({ private: true, name: 'baci-first-card-public' })
  );
  contents.set(
    'apps/web/tsconfig.json',
    JSON.stringify({
      compilerOptions,
      include: [
        'next-env.d.ts',
        'src/**/*.ts',
        'src/**/*.tsx',
        '.next/types/**/*.ts',
      ],
      exclude: ['node_modules'],
    })
  );
  contents.set(
    'apps/web/src/app/layout.tsx',
    `import type { ReactNode } from 'react';
import './styles.css';
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
`
  );
  contents.set(
    'apps/web/src/app/styles.css',
    `:root{color-scheme:light dark;--store-background:#f5f5f5;--store-card:#fff;--store-text:#181818;--store-muted:#555;--store-accent:#ffb321}
@media(prefers-color-scheme:dark){:root{--store-background:#090909;--store-card:#191919;--store-text:#fafafa;--store-muted:#bbb}}
*{box-sizing:border-box}body{margin:0;background:var(--store-background);color:var(--store-text);font:16px/1.6 system-ui,sans-serif}
main{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px}
section{width:100%;max-width:440px;background:var(--store-card);padding:32px;border:1px solid var(--store-muted);border-radius:24px}
h1{font-size:26px;line-height:1.2}p{color:var(--store-muted)}a{display:flex;min-height:48px;align-items:center;justify-content:center;background:var(--store-accent);color:#151515;border-radius:99px;padding:12px 20px;text-decoration:none;font-weight:700}
a:focus-visible{outline:3px solid var(--store-accent);outline-offset:4px}
`
  );
  contents.set(
    'apps/web/src/public-env.ts',
    "export const getSupabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';\nexport const getSupabaseAnonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';\n"
  );
  const generated = Object.fromEntries(
    [...contents]
      .filter(([name]) => !sources[name])
      .map(([name, content]) => [name, digest(content)])
  );
  const rewrites = Object.fromEntries(
    [...contents]
      .filter(([name, content]) => sources[name] && sources[name] !== digest(content))
      .map(([name, content]) => [name, digest(content)])
  );
  await mkdir(destination, { mode: 0o700 });
  for (const [name, content] of contents) {
    const target = path.join(destination, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { flag: 'wx', mode: 0o600 });
  }
  await mkdir(path.join(destination, 'apps/web/public'), { recursive: true });
  const report = { version: 2, sources, rewrites, generated };
  await writeFile(
    path.join(destination, 'source-manifest.json'),
    JSON.stringify(report, null, 2),
    { flag: 'wx' }
  );
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [root, destination] = process.argv.slice(2);
  if (!root || !destination || process.argv.length !== 4)
    throw new Error('Provide source and new output directories');
  const report = await snapshot(root, destination);
  console.log(
    JSON.stringify({
      status: 'source-snapshotted',
      files: Object.keys(report.sources).length,
      destination,
    })
  );
}
