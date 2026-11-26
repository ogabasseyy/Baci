import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import {
  ALLOWED_STOREFRONT_PACKAGES,
  type CspGovernanceSummary,
  parseWorkerStorefrontManifest,
  summarizeCspGovernance,
  WORKER_COMPILER_LIMITS,
  type WorkerStorefrontManifest,
} from '../schemas/worker-manifest';
import {
  COMPILER_ROOT,
  createClosedStorefrontGraphPlugin,
  StorefrontCompilerError,
} from './closed-graph-plugin';
import { scanManifestSourceSafety } from './source-guard';
import { compileStorefrontTailwindCss } from './tailwind-css';
import {
  buildClientHydrationEntrySource,
  buildWorkerSsrEntrySource,
} from './worker-runtime-template';

export { StorefrontCompilerError };

export interface CompiledStorefrontRelease {
  buildDigest: string;
  sourceDigest: string;
  workerCode: string;
  clientCode: string;
  cssCode: string;
  assets: {
    clientAssetPath: string;
    cssAssetPath: string;
  };
  metrics: {
    workerRawBytes: number;
    workerGzipBytes: number;
    clientRawBytes: number;
    clientGzipBytes: number;
    cssRawBytes: number;
    cssGzipBytes: number;
  };
  /** Enforced zero-binding contract so User Workers cannot bypass Outbound Worker. */
  bindings: readonly [];
  cspGovernance: CspGovernanceSummary;
}

function sha256Hex(chunks: readonly string[]): string {
  const hash = createHash('sha256');
  for (const chunk of chunks) {
    hash.update(chunk);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export async function compileStorefrontWorker(
  rawInput: unknown
): Promise<CompiledStorefrontRelease> {
  let manifest: WorkerStorefrontManifest;
  try {
    manifest = parseWorkerStorefrontManifest(rawInput);
  } catch (error) {
    throw new StorefrontCompilerError(
      'INVALID_MANIFEST',
      error instanceof Error ? error.message : 'Invalid storefront manifest'
    );
  }

  const safetyViolations = scanManifestSourceSafety(manifest);
  if (safetyViolations.length > 0) {
    throw new StorefrontCompilerError(
      'SOURCE_SAFETY_VIOLATION',
      safetyViolations.map((v) => `${v.filePath}: ${v.detail}`).join('; '),
      safetyViolations
    );
  }

  let compiledCss: Awaited<ReturnType<typeof compileStorefrontTailwindCss>>;
  try {
    compiledCss = await compileStorefrontTailwindCss(manifest);
  } catch (error) {
    if (error instanceof StorefrontCompilerError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const code = message.includes('exceeds')
      ? 'BUDGET_EXCEEDED'
      : 'GRAPH_ESCAPE_BLOCKED';
    throw new StorefrontCompilerError(code, message);
  }
  const cssHash = sha256Hex([compiledCss.css]).slice(0, 12);
  const cssAssetPath = `/_baci/assets/styles.${cssHash}.css`;

  const declaredPackages = new Set<string>(['react', 'react-dom']);
  for (const pkg of manifest.packages) {
    if ((ALLOWED_STOREFRONT_PACKAGES as readonly string[]).includes(pkg.name)) {
      declaredPackages.add(pkg.name);
    }
  }
  const declaredAssetIds = new Set(manifest.assets.map((a) => a.assetId));

  const clientVirtualFiles = new Map(
    manifest.files.map((f) => [f.path, f.content])
  );
  const clientEntryName = '__baci_client_entry__.tsx';
  clientVirtualFiles.set(
    clientEntryName,
    buildClientHydrationEntrySource(manifest.entry)
  );

  let clientBuild: Awaited<ReturnType<typeof build>>;
  try {
    clientBuild = await build({
      entryPoints: [clientEntryName],
      absWorkingDir: COMPILER_ROOT,
      bundle: true,
      platform: 'browser',
      format: 'esm',
      jsx: 'automatic',
      write: false,
      minify: true,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [
        createClosedStorefrontGraphPlugin({
          virtualFiles: clientVirtualFiles,
          declaredPackages,
          declaredAssetIds,
        }),
      ],
    });
  } catch (error) {
    if (error instanceof StorefrontCompilerError) throw error;
    throw new StorefrontCompilerError(
      'GRAPH_ESCAPE_BLOCKED',
      error instanceof Error ? error.message : 'Client bundle failed'
    );
  }

  const clientCode = clientBuild.outputFiles?.[0]?.text ?? '';
  const clientRawBytes = Buffer.byteLength(clientCode, 'utf8');
  const clientGzipBytes = gzipSync(Buffer.from(clientCode, 'utf8')).byteLength;
  if (
    !clientCode ||
    clientGzipBytes > WORKER_COMPILER_LIMITS.maxClientGzipBytes
  ) {
    throw new StorefrontCompilerError(
      'BUDGET_EXCEEDED',
      `Client JS bundle (${clientGzipBytes} gzipped bytes) exceeds 150 KiB budget`
    );
  }

  const clientHash = sha256Hex([clientCode]).slice(0, 12);
  const clientAssetPath = `/_baci/assets/client.${clientHash}.js`;

  const workerVirtualFiles = new Map(
    manifest.files.map((f) => [f.path, f.content])
  );
  const workerEntryName = '__baci_worker_entry__.tsx';
  workerVirtualFiles.set(
    workerEntryName,
    buildWorkerSsrEntrySource({
      manifest,
      cssAssetPath,
      clientAssetPath,
    })
  );

  let workerBuild: Awaited<ReturnType<typeof build>>;
  try {
    workerBuild = await build({
      entryPoints: [workerEntryName],
      absWorkingDir: COMPILER_ROOT,
      bundle: true,
      platform: 'neutral',
      format: 'esm',
      conditions: ['workerd', 'worker', 'browser', 'import'],
      mainFields: ['browser', 'module', 'main'],
      jsx: 'automatic',
      write: false,
      minify: true,
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [
        createClosedStorefrontGraphPlugin({
          virtualFiles: workerVirtualFiles,
          declaredPackages,
          declaredAssetIds,
        }),
      ],
    });
  } catch (error) {
    if (error instanceof StorefrontCompilerError) throw error;
    throw new StorefrontCompilerError(
      'GRAPH_ESCAPE_BLOCKED',
      error instanceof Error ? error.message : 'Worker bundle failed'
    );
  }

  const workerCode = workerBuild.outputFiles?.[0]?.text ?? '';
  const workerRawBytes = Buffer.byteLength(workerCode, 'utf8');
  const workerGzipBytes = gzipSync(Buffer.from(workerCode, 'utf8')).byteLength;
  if (
    !workerCode ||
    workerGzipBytes > WORKER_COMPILER_LIMITS.maxWorkerGzipBytes
  ) {
    throw new StorefrontCompilerError(
      'BUDGET_EXCEEDED',
      `Worker SSR bundle (${workerGzipBytes} gzipped bytes) exceeds 1 MiB budget`
    );
  }

  const canonicalFiles = [...manifest.files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `${f.path}:${f.content}`);
  const sourceDigest = sha256Hex([
    manifest.format,
    manifest.mode,
    manifest.entry,
    ...canonicalFiles,
  ]);
  const buildDigest = sha256Hex([workerCode, clientCode, compiledCss.css]);

  return {
    buildDigest,
    sourceDigest,
    workerCode,
    clientCode,
    cssCode: compiledCss.css,
    assets: {
      clientAssetPath,
      cssAssetPath,
    },
    metrics: {
      workerRawBytes,
      workerGzipBytes,
      clientRawBytes,
      clientGzipBytes,
      cssRawBytes: compiledCss.rawBytes,
      cssGzipBytes: compiledCss.gzipBytes,
    },
    bindings: [],
    cspGovernance: summarizeCspGovernance(manifest.cspAllowlist),
  };
}
