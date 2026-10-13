import { describe, expect, it, vi } from 'vitest';
import { runReplayArtifactCli } from './command';

const argumentsList = [
  '--receiver-root',
  '/receiver/apps/web',
  '--savings-root',
  '/savings/apps/web/src',
  '--output-directory',
  '/temporary/fresh-release',
];

describe('replay artifact CLI', () => {
  it('builds both selected source roots without a deployment action', async () => {
    const result = {
      manifestPath: '/temporary/fresh-release/replay-artifact.manifest.json',
      outputDirectory: '/temporary/fresh-release',
      outputs: {
        'replay-daemon.mjs': 'daemon-digest',
        'prefunded-replay-bundle.mjs': 'factory-digest',
      },
    };
    const build = vi.fn().mockResolvedValue(result);

    await expect(runReplayArtifactCli(argumentsList, build)).resolves.toEqual(
      result
    );
    expect(build).toHaveBeenCalledOnce();
    expect(build).toHaveBeenCalledWith({
      receiverRoot: '/receiver/apps/web',
      savingsRoot: '/savings/apps/web/src',
      outputDirectory: '/temporary/fresh-release',
    });
  });

  it.each(
    [
      [],
      ['--receiver-root'],
      ['--receiver-root', '--savings-root'],
      ['--unknown', '/temporary'],
      ['--receiver-root', ' '],
      [...argumentsList, '--receiver-root', '/different-source'],
      [...argumentsList, '--output-directory', '/different-output'],
      [...argumentsList, '--activate', 'true'],
      [...argumentsList, 'unrequested-positional-input'],
    ].map((input) => ({ input }))
  )('refuses invalid or ambiguous arguments before building: $input', async ({
    input,
  }) => {
    const build = vi.fn();

    await expect(runReplayArtifactCli(input, build)).rejects.toThrow();
    expect(build).not.toHaveBeenCalled();
  });

  it('propagates a refused build without starting another build', async () => {
    const build = vi.fn().mockRejectedValue(new Error('Fresh output required'));

    await expect(runReplayArtifactCli(argumentsList, build)).rejects.toThrow(
      'Fresh output required'
    );
    expect(build).toHaveBeenCalledOnce();
  });
});
