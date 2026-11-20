import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createPreviewHtml } from '../../builder-mcp-server/widgets/build.mjs';
import { buildPublicObservationWorker } from '../../experience-runtime/public-observer-bundle.mjs';

const entries = {
  builder: 'tools/builder-production/production-main.ts',
  verifier: 'tools/experience-verifier/production-main.ts',
  runner: 'tools/experience-runner/production-main.ts',
  preflight: 'tools/experience-runner/privileged-preflight-main.ts',
} as const;

/** Builds a fixed operator entry. External runtime dependencies still require provisioning. */
export async function bundleOperatorService(
  kind: keyof typeof entries,
  outfile: string
) {
  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const require = createRequire(import.meta.url);
  const serverOnlyEmpty = resolve(
    dirname(require.resolve('server-only')),
    'empty.js'
  );
  const result = await build({
    absWorkingDir: webRoot,
    entryPoints: [entries[kind]],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    tsconfig: 'tsconfig.experience-runner.json',
    external: ['sharp', 'jsdom', 'next', 'next/*'],
    alias: {
      'server-only': serverOnlyEmpty,
      'next/link': 'next/link.js',
      'next/image': 'next/image.js',
    },
    banner: {
      js: "import { createRequire as __baciCreateRequire } from 'node:module'; const require = __baciCreateRequire(import.meta.url);",
    },
    logLevel: 'silent',
  });
  if (kind === 'builder') {
    const widget = await createPreviewHtml();
    await writeFile(resolve(dirname(outfile), 'preview.html'), widget.html);
  }
  return result;
}

export function bundleBuilderOperator(outfile: string) {
  return bundleOperatorService('builder', outfile);
}

/** Fixed browser worker; Playwright is provided by the pinned browser rootfs. */
export function bundlePublicObservationWorker(outfile: string) {
  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  return buildPublicObservationWorker(webRoot, outfile);
}
