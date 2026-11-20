import { build } from 'esbuild';

/** One byte-identical observer build for installation pins and operator bundles. */
export function buildPublicObservationWorker(webRoot, outfile) {
  return build({
    absWorkingDir: webRoot,
    entryPoints: ['tools/experience-runner/public-observation-worker.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    tsconfig: 'tsconfig.experience-runner.json',
    external: ['playwright-core'],
    logLevel: 'silent',
  });
}
