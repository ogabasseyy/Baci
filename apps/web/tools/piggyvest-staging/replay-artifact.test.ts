import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildReplayArtifact } from './replay-artifact';

const temporaryDirectories: string[] = [];
type ReplayArtifactBundle = NonNullable<
  NonNullable<Parameters<typeof buildReplayArtifact>[1]>['bundle']
>;

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'replay-artifact-'));
  temporaryDirectories.push(root);
  const receiverRoot = join(root, 'receiver', 'apps', 'web');
  const savingsRoot = join(root, 'savings', 'apps', 'web', 'src');
  await Promise.all([
    mkdir(join(receiverRoot, 'tools', 'piggyvest-staging'), {
      recursive: true,
    }),
    mkdir(join(receiverRoot, 'src', 'schemas', 'piggyvest'), {
      recursive: true,
    }),
    mkdir(join(savingsRoot, 'lib', 'piggyvest'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(receiverRoot, 'package.json'), '{"name":"receiver"}'),
    writeFile(
      join(receiverRoot, 'tools', 'piggyvest-staging', 'replay-daemon.ts'),
      'export const daemon = true;'
    ),
    writeFile(
      join(receiverRoot, 'src', 'schemas', 'piggyvest', 'events.ts'),
      'export const event = true;'
    ),
    writeFile(
      join(savingsRoot, 'lib', 'piggyvest', 'prefunded-card-replay-runtime.ts'),
      'export const createPrefundedCardReplayRuntime = () => null;'
    ),
  ]);
  return { outputDirectory: join(root, 'artifact'), receiverRoot, savingsRoot };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe('replay artifact builder', () => {
  it('accepts receiver source imports and records source and entrypoint digests', async () => {
    const fixture = await createFixture();
    const bundle = vi.fn<ReplayArtifactBundle>(async (options) => {
      await writeFile(options.outfile, `bundle:${options.entryPoints[0]}`);
      const sourceInputs = {
        [options.entryPoints[0]]: {},
        ...(options.entryPoints[0].includes('replay-daemon')
          ? {
              [join(fixture.receiverRoot, 'src/schemas/piggyvest/events.ts')]:
                {},
            }
          : {}),
      };
      return {
        metafile: {
          inputs: sourceInputs,
          outputs: {
            [options.outfile]: {
              imports: [
                { external: true, path: 'node:fs/promises' },
                { external: true, path: 'events' },
                { external: true, path: 'net' },
                { external: true, path: 'pg-native' },
              ],
            },
          },
        },
      };
    });

    const artifact = await buildReplayArtifact(fixture, { bundle });
    const manifest = JSON.parse(await readFile(artifact.manifestPath, 'utf8'));

    expect(bundle).toHaveBeenCalledTimes(2);
    expect(bundle.mock.calls.map(([options]) => options.conditions)).toEqual([
      ['react-server'],
      ['react-server'],
    ]);
    expect(bundle.mock.calls.map(([options]) => options.external)).toEqual([
      ['pg-native'],
      ['pg-native'],
    ]);
    expect(bundle.mock.calls.map(([options]) => options.banner.js)).toEqual([
      expect.stringContaining('createRequire'),
      expect.stringContaining('createRequire'),
    ]);
    expect(Object.keys(artifact.outputs)).toEqual([
      'replay-daemon.mjs',
      'prefunded-replay-bundle.mjs',
    ]);
    expect(manifest.source.entrypoints).toEqual({
      receiver: {
        path: join(
          fixture.receiverRoot,
          'tools/piggyvest-staging/replay-daemon.ts'
        ),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      prefundedReplay: {
        path: join(
          fixture.savingsRoot,
          'lib/piggyvest/prefunded-card-replay-runtime.ts'
        ),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(manifest.source.inputs.receiver).toEqual([
      {
        path: join(fixture.receiverRoot, 'src/schemas/piggyvest/events.ts'),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      {
        path: join(
          fixture.receiverRoot,
          'tools/piggyvest-staging/replay-daemon.ts'
        ),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    ]);
  });

  it('rejects source outside the receiver tool and app source roots', async () => {
    const fixture = await createFixture();
    await expect(
      buildReplayArtifact(fixture, {
        bundle: async (options) => {
          await writeFile(options.outfile, 'bundle');
          return {
            metafile: {
              inputs: {
                [join(fixture.receiverRoot, 'src-other/replay.ts')]: {},
              },
              outputs: { [options.outfile]: { imports: [] } },
            },
          };
        },
      })
    ).rejects.toThrow('outside the approved roots');
  });

  it('rejects virtual inputs and imports that leave the artifact', async () => {
    const fixture = await createFixture();
    const rejectVirtualInput: ReplayArtifactBundle = async (options) => {
      await writeFile(options.outfile, 'bundle');
      return {
        metafile: {
          inputs: { '<stdin>': {} },
          outputs: { [options.outfile]: { imports: [] } },
        },
      };
    };
    await expect(
      buildReplayArtifact(fixture, { bundle: rejectVirtualInput })
    ).rejects.toThrow('Virtual metafile input');

    const packageFixture = await createFixture();
    const rejectExternalPackage: ReplayArtifactBundle = async (options) => {
      await writeFile(options.outfile, 'bundle');
      return {
        metafile: {
          inputs: { [options.entryPoints[0]]: {} },
          outputs: {
            [options.outfile]: {
              imports: [{ external: true, path: 'otherpackage' }],
            },
          },
        },
      };
    };
    await expect(
      buildReplayArtifact(packageFixture, { bundle: rejectExternalPackage })
    ).rejects.toThrow('unsupported import');

    const pathFixture = await createFixture();
    const rejectExternalPath: ReplayArtifactBundle = async (options) => {
      await writeFile(options.outfile, 'bundle');
      return {
        metafile: {
          inputs: { [options.entryPoints[0]]: {} },
          outputs: {
            [options.outfile]: {
              imports: [
                {
                  external: false,
                  path: '/Users/mac/Baci-worktrees/replay.mjs',
                },
              ],
            },
          },
        },
      };
    };
    await expect(
      buildReplayArtifact(pathFixture, { bundle: rejectExternalPath })
    ).rejects.toThrow('unsupported import');
  });

  it('does not overwrite an existing artifact directory', async () => {
    const fixture = await createFixture();
    await mkdir(fixture.outputDirectory);
    const bundle = vi.fn();

    await expect(buildReplayArtifact(fixture, { bundle })).rejects.toThrow(
      'fresh'
    );
    expect(bundle).not.toHaveBeenCalled();
  });

  it.each([
    'node:not-a-built-in',
    './outside.mjs',
    'node_modules/otherpackage',
  ])('rejects external modules masquerading as built-ins: %s', async (path) => {
    const fixture = await createFixture();
    const bundle: ReplayArtifactBundle = async (options) => {
      await writeFile(options.outfile, 'bundle');
      return {
        metafile: {
          inputs: { [options.entryPoints[0]]: {} },
          outputs: {
            [options.outfile]: { imports: [{ external: true, path }] },
          },
        },
      };
    };
    await expect(buildReplayArtifact(fixture, { bundle })).rejects.toThrow(
      'unsupported import'
    );
  });
});
