import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SUPABASE_REPLAY_PORT_KEYS,
  type SupabaseReplayPortMap,
} from './allocate-supabase-replay-ports';
import { canonicalJsonValue } from './canonical-json-value';
import {
  createReplayProjectOwnership,
  readReplayProjectOwnership,
  replayProjectOwnershipPath,
  stopOwnedReplayProject,
  writeReplayProjectOwnership,
} from './replay-project-ownership';

const roots: string[] = [];
const ports = Object.fromEntries(
  SUPABASE_REPLAY_PORT_KEYS.map((key, index) => [key, 42_000 + index])
) as SupabaseReplayPortMap;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function ownedWorkdir(): Promise<{ root: string; workdir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'baci-replay-owner-root-'));
  roots.push(root);
  const workdir = await mkdtemp(path.join(root, 'project-'));
  return { root, workdir };
}

async function stoppableOwnership(root: string, workdir: string) {
  const config = 'owned replay config\n';
  await mkdir(path.join(workdir, 'supabase'), { recursive: true });
  await writeFile(path.join(workdir, 'supabase/config.toml'), config);
  const ownership = await createReplayProjectOwnership({
    originalConfigSha256: 'a'.repeat(64),
    ownedTempRoot: root,
    ports,
    preStartEmpty: { containers: true, networks: true, volumes: true },
    projectId: 'baci_replay_abc123',
    rewrittenConfigSha256: createHash('sha256').update(config).digest('hex'),
    workdir,
  });
  await writeReplayProjectOwnership(ownership);
  return ownership;
}

describe('replay project ownership', () => {
  it('round-trips a create-only secret-free ownership marker', async () => {
    const { root, workdir } = await ownedWorkdir();
    const ownership = await createReplayProjectOwnership({
      originalConfigSha256: 'a'.repeat(64),
      ownedTempRoot: root,
      ports,
      preStartEmpty: { containers: true, networks: true, volumes: true },
      projectId: 'baci_replay_abc123',
      rewrittenConfigSha256: 'b'.repeat(64),
      workdir,
    });

    await writeReplayProjectOwnership(ownership);

    await expect(
      readReplayProjectOwnership(replayProjectOwnershipPath(workdir), {
        ownedTempRoot: root,
        ports,
        projectId: 'baci_replay_abc123',
        workdir,
      })
    ).resolves.toEqual(ownership);
    await expect(writeReplayProjectOwnership(ownership)).rejects.toThrow(
      /^Replay ownership marker already exists$/
    );
  });

  it('accepts a canonically serialized retry marker', async () => {
    const { root, workdir } = await ownedWorkdir();
    const ownership = await createReplayProjectOwnership({
      originalConfigSha256: 'a'.repeat(64),
      ownedTempRoot: root,
      ports,
      preStartEmpty: { containers: true, networks: true, volumes: true },
      projectId: 'baci_replay_abc123',
      rewrittenConfigSha256: 'b'.repeat(64),
      workdir,
    });
    await writeFile(
      replayProjectOwnershipPath(workdir),
      canonicalJsonValue(ownership)
    );

    await expect(
      readReplayProjectOwnership(replayProjectOwnershipPath(workdir), {
        ownedTempRoot: root,
        ports,
        projectId: ownership.projectId,
        workdir,
      })
    ).resolves.toEqual(ownership);
  });

  it('rejects a workdir outside the owned temporary root', async () => {
    const { root } = await ownedWorkdir();

    await expect(
      createReplayProjectOwnership({
        originalConfigSha256: 'a'.repeat(64),
        ownedTempRoot: root,
        ports,
        preStartEmpty: { containers: true, networks: true, volumes: true },
        projectId: 'baci_replay_abc123',
        rewrittenConfigSha256: 'b'.repeat(64),
        workdir: tmpdir(),
      })
    ).rejects.toThrow(/^Replay workdir is outside the owned temporary root$/);
  });

  it('rejects marker extras and expected-identity mismatches', async () => {
    const { root, workdir } = await ownedWorkdir();
    const markerPath = replayProjectOwnershipPath(workdir);
    await writeFile(
      markerPath,
      JSON.stringify({
        databaseUrl: 'postgresql://user:secret@localhost/db',
        projectId: 'other',
      })
    );

    await expect(
      readReplayProjectOwnership(markerPath, {
        ownedTempRoot: root,
        ports,
        projectId: 'baci_replay_abc123',
        workdir,
      })
    ).rejects.toThrow(/^Invalid replay ownership marker$/);
  });

  it('revalidates the on-disk marker immediately before an owned stop', async () => {
    const { root, workdir } = await ownedWorkdir();
    const ownership = await stoppableOwnership(root, workdir);
    const inspectResources = vi
      .fn()
      .mockResolvedValueOnce({ containers: [], networks: [], volumes: [] })
      .mockResolvedValueOnce({ containers: [], networks: [], volumes: [] });
    const runCommand = vi.fn(async () => ({ stderr: '', stdout: '' }));

    await stopOwnedReplayProject({
      expectedResources: { containers: [], networks: [], volumes: [] },
      inspectResources,
      ownedTempRoot: root,
      ownership,
      runCommand,
    });

    expect(runCommand).toHaveBeenCalledWith('supabase', [
      'stop',
      '--no-backup',
      '--workdir',
      ownership.workdir,
    ]);
    expect(inspectResources).toHaveBeenCalledTimes(2);
    expect(inspectResources.mock.invocationCallOrder[0]).toBeLessThan(
      runCommand.mock.invocationCallOrder[0] as number
    );
    expect(runCommand.mock.invocationCallOrder[0]).toBeLessThan(
      inspectResources.mock.invocationCallOrder[1] as number
    );
  });

  it('never stops when the on-disk marker changed', async () => {
    const { root, workdir } = await ownedWorkdir();
    const ownership = await stoppableOwnership(root, workdir);
    await writeFile(
      replayProjectOwnershipPath(workdir),
      `${JSON.stringify({ ...ownership, rewrittenConfigSha256: 'c'.repeat(64) })}\n`
    );
    const runCommand = vi.fn(async () => ({ stderr: '', stdout: '' }));

    await expect(
      stopOwnedReplayProject({
        inspectResources: async () => ({
          containers: [],
          networks: [],
          volumes: [],
        }),
        ownedTempRoot: root,
        ownership,
        runCommand,
      })
    ).rejects.toThrow(/^Invalid replay ownership marker$/);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('returns sanitized diagnostics after an owned transient migration anomaly is fully stopped', async () => {
    const { root, workdir } = await ownedWorkdir();
    const ownership = await stoppableOwnership(root, workdir);
    const projectLabel = {
      'com.supabase.cli.project': ownership.projectId,
    };
    const inspectResources = vi
      .fn()
      .mockResolvedValueOnce({
        containers: [
          {
            image: 'public.ecr.aws/supabase/postgres:17.6.1.156',
            labels: projectLabel,
            name: `supabase_db_${ownership.projectId}`,
          },
          {
            image: 'public.ecr.aws/supabase/gotrue:v2.194.0',
            labels: projectLabel,
            name: 'dreamy_einstein',
          },
        ],
        networks: [
          {
            labels: projectLabel,
            name: `supabase_network_${ownership.projectId}`,
          },
        ],
        volumes: [
          {
            labels: projectLabel,
            name: `supabase_db_${ownership.projectId}`,
          },
        ],
      })
      .mockResolvedValueOnce({ containers: [], networks: [], volumes: [] });
    const runCommand = vi.fn(async () => ({ stderr: '', stdout: '' }));

    await expect(
      stopOwnedReplayProject({
        expectedResources: {
          containers: [
            {
              image: 'public.ecr.aws/supabase/postgres:17.6.1.156',
              name: `supabase_db_${ownership.projectId}`,
            },
          ],
          networks: [`supabase_network_${ownership.projectId}`],
          volumes: [`supabase_db_${ownership.projectId}`],
        },
        inspectResources,
        ownedTempRoot: root,
        ownership,
        runCommand,
      })
    ).resolves.toEqual({ resourceReadiness: 'anomalous' });
    expect(runCommand).toHaveBeenCalledWith('supabase', [
      'stop',
      '--no-backup',
      '--workdir',
      ownership.workdir,
    ]);
    expect(inspectResources).toHaveBeenCalledTimes(2);
    expect(inspectResources.mock.invocationCallOrder[0]).toBeLessThan(
      runCommand.mock.invocationCallOrder[0] as number
    );
    expect(runCommand.mock.invocationCallOrder[0]).toBeLessThan(
      inspectResources.mock.invocationCallOrder[1] as number
    );
  });

  it('never stops when the rewritten config changed', async () => {
    const { root, workdir } = await ownedWorkdir();
    const ownership = await stoppableOwnership(root, workdir);
    await writeFile(path.join(workdir, 'supabase/config.toml'), 'changed\n');
    const runCommand = vi.fn(async () => ({ stderr: '', stdout: '' }));

    await expect(
      stopOwnedReplayProject({
        inspectResources: async () => ({
          containers: [],
          networks: [],
          volumes: [],
        }),
        ownedTempRoot: root,
        ownership,
        runCommand,
      })
    ).rejects.toThrow(/^Invalid replay ownership config$/);
    expect(runCommand).not.toHaveBeenCalled();
  });
});
