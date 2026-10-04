import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire, isBuiltin } from 'node:module';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import {
  type ReplayArtifactInput,
  replayArtifactInputSchema,
} from './schemas/replay-artifact';

const receiverEntrypointRelativePath = join(
  'tools',
  'piggyvest-staging',
  'replay-daemon.ts'
);
const savingsEntrypointRelativePath = join(
  'lib',
  'piggyvest',
  'prefunded-card-replay-runtime.ts'
);
const manifestFileName = 'replay-artifact.manifest.json';
const outputFileNames = [
  'replay-daemon.mjs',
  'prefunded-replay-bundle.mjs',
] as const;

interface ReplayBundleOptions {
  absWorkingDir: string;
  banner: { js: string };
  bundle: true;
  conditions: string[];
  entryPoints: string[];
  external: string[];
  format: 'esm';
  metafile: true;
  outfile: string;
  platform: 'node';
  sourcemap: false;
  target: string;
}

interface ReplayBundleResult {
  metafile?: {
    inputs: Record<string, unknown>;
    outputs?: Record<
      string,
      { imports: Array<{ external?: boolean; path: string }> }
    >;
  };
}

type ReplayBundler = (
  options: ReplayBundleOptions
) => Promise<ReplayBundleResult>;

interface EsbuildModule {
  build: ReplayBundler;
}

interface ReplayArtifactDependencies {
  bundle?: ReplayBundler;
}

export interface ReplayArtifactResult {
  manifestPath: string;
  outputDirectory: string;
  outputs: Record<(typeof outputFileNames)[number], string>;
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === '' ||
    (!pathFromRoot.startsWith(`..${sep}`) &&
      pathFromRoot !== '..' &&
      !pathFromRoot.includes(`${sep}..${sep}`))
  );
}

async function requireDirectory(
  path: string,
  description: string
): Promise<void> {
  const details = await stat(path).catch(() => null);
  if (!details?.isDirectory())
    throw new Error(`${description} must be a directory`);
}

async function requireFile(path: string, description: string): Promise<void> {
  const details = await stat(path).catch(() => null);
  if (!details?.isFile()) throw new Error(`${description} is missing`);
}

function resolveBundler(receiverRoot: string): ReplayBundler {
  const receiverRequire = createRequire(join(receiverRoot, 'package.json'));
  try {
    return (receiverRequire('esbuild') as EsbuildModule).build;
  } catch {
    const tsxCli = receiverRequire.resolve('tsx/cli');
    const tsxRequire = createRequire(tsxCli);
    return (tsxRequire(tsxRequire.resolve('esbuild')) as EsbuildModule).build;
  }
}

function sourcePath(input: string, workingDirectory: string): string {
  if (input.startsWith('<')) {
    throw new Error(`Virtual metafile input is not supported: ${input}`);
  }
  return resolve(workingDirectory, input);
}

function assertBoundedGraph(
  metafile: ReplayBundleResult['metafile'],
  workingDirectory: string,
  roots: string[]
): string[] {
  if (!metafile) throw new Error('Bundler did not return a metafile');
  const approvedInputs: string[] = [];
  for (const input of Object.keys(metafile.inputs)) {
    const path = sourcePath(input, workingDirectory);
    if (path.split(sep).includes('node_modules')) continue;
    if (!roots.some((root) => isWithin(root, path))) {
      throw new Error(`Bundle source is outside the approved roots: ${input}`);
    }
    approvedInputs.push(path);
  }
  return approvedInputs.sort();
}

function assertRuntimeImports(metafile: ReplayBundleResult['metafile']): void {
  if (!metafile?.outputs) throw new Error('Bundler metafile has no outputs');
  for (const output of Object.values(metafile.outputs)) {
    for (const imported of output.imports) {
      if (
        imported.external &&
        (isBuiltin(imported.path) || imported.path === 'pg-native')
      ) {
        continue;
      }
      throw new Error(
        `Bundle output has an unsupported import: ${imported.path}`
      );
    }
  }
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function digestSources(paths: string[]) {
  return await Promise.all(
    paths.map(async (path) => ({ path, sha256: await sha256(path) }))
  );
}

async function assertRuntimeBundleHasNoWorktreePath(
  path: string
): Promise<void> {
  if ((await readFile(path, 'utf8')).includes('/worktrees/')) {
    throw new Error(
      `Runtime bundle contains a worktree path: ${basename(path)}`
    );
  }
}

async function createFreshOutputDirectory(
  outputDirectory: string
): Promise<void> {
  await mkdir(dirname(outputDirectory), { recursive: true });
  try {
    await mkdir(outputDirectory);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(
        'Output directory must be fresh and must not already exist'
      );
    }
    throw error;
  }
}

export async function buildReplayArtifact(
  rawInput: ReplayArtifactInput,
  dependencies: ReplayArtifactDependencies = {}
): Promise<ReplayArtifactResult> {
  const input = replayArtifactInputSchema.parse(rawInput);
  const receiverRoot = resolve(input.receiverRoot);
  const savingsRoot = resolve(input.savingsRoot);
  const outputDirectory = resolve(input.outputDirectory);
  const receiverSourceRoot = join(receiverRoot, 'tools', 'piggyvest-staging');
  const receiverAppSourceRoot = join(receiverRoot, 'src');
  const receiverEntrypoint = join(receiverRoot, receiverEntrypointRelativePath);
  const savingsEntrypoint = join(savingsRoot, savingsEntrypointRelativePath);

  await Promise.all([
    requireDirectory(receiverRoot, 'Receiver root'),
    requireDirectory(receiverAppSourceRoot, 'Receiver app source root'),
    requireDirectory(savingsRoot, 'Savings root'),
    requireFile(join(receiverRoot, 'package.json'), 'Receiver package.json'),
    requireFile(receiverEntrypoint, 'Receiver replay daemon entrypoint'),
    requireFile(savingsEntrypoint, 'Canonical replay runtime entrypoint'),
  ]);
  if (
    !isWithin(receiverSourceRoot, receiverEntrypoint) ||
    !isWithin(savingsRoot, savingsEntrypoint)
  ) {
    throw new Error(
      'Replay entrypoints must remain in their approved source roots'
    );
  }

  await createFreshOutputDirectory(outputDirectory);
  const bundle = dependencies.bundle ?? resolveBundler(receiverRoot);
  const bundleOptions: Omit<ReplayBundleOptions, 'entryPoints' | 'outfile'> = {
    absWorkingDir: receiverRoot,
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
    bundle: true,
    conditions: ['react-server'],
    external: ['pg-native'],
    format: 'esm' as const,
    metafile: true,
    platform: 'node' as const,
    sourcemap: false,
    target: 'node24',
  };
  const approvedRoots = [
    receiverSourceRoot,
    receiverAppSourceRoot,
    savingsRoot,
  ];
  const entries = [
    [receiverEntrypoint, outputFileNames[0]],
    [savingsEntrypoint, outputFileNames[1]],
  ] as const;
  const sourceInputs: Record<'receiver' | 'prefundedReplay', string[]> = {
    receiver: [],
    prefundedReplay: [],
  };

  for (const [index, [entryPoint, outputFileName]] of entries.entries()) {
    const result = await bundle({
      ...bundleOptions,
      entryPoints: [entryPoint],
      outfile: join(outputDirectory, outputFileName),
    });
    sourceInputs[index === 0 ? 'receiver' : 'prefundedReplay'] =
      assertBoundedGraph(result.metafile, receiverRoot, approvedRoots);
    assertRuntimeImports(result.metafile);
  }

  const outputs = Object.fromEntries(
    await Promise.all(
      outputFileNames.map(async (fileName) => {
        const outputPath = join(outputDirectory, fileName);
        await requireFile(outputPath, `Bundle output ${fileName}`);
        await assertRuntimeBundleHasNoWorktreePath(outputPath);
        return [fileName, await sha256(outputPath)] as const;
      })
    )
  ) as ReplayArtifactResult['outputs'];
  const manifestPath = join(outputDirectory, manifestFileName);
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        version: 1,
        source: {
          receiverRoot,
          savingsRoot,
          entrypoints: {
            receiver: {
              path: receiverEntrypoint,
              sha256: await sha256(receiverEntrypoint),
            },
            prefundedReplay: {
              path: savingsEntrypoint,
              sha256: await sha256(savingsEntrypoint),
            },
          },
          inputs: {
            receiver: await digestSources(sourceInputs.receiver),
            prefundedReplay: await digestSources(sourceInputs.prefundedReplay),
          },
        },
        outputs,
      },
      null,
      2
    )}\n`
  );
  return { manifestPath, outputDirectory, outputs };
}
