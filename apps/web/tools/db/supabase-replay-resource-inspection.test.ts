import { describe, expect, it, vi } from 'vitest';
import {
  assertSupabaseReplayResources,
  expectedSupabaseReplayResources,
  inspectSupabaseReplayResources,
  SUPABASE_PROJECT_LABEL,
} from './supabase-replay-expected-resources';

const projectId = 'baci_replay_abc123';

describe('inspectSupabaseReplayResources', () => {
  it.each([
    '',
    'com.supabase.cli.project=foreign',
  ])('detects an exact cache volume even with foreign or missing labels: %s', async (labels) => {
    const cacheName = `supabase_edge_runtime_${projectId}`;
    const runCommand = vi.fn(
      async (_command: string, args: readonly string[]) => ({
        stderr: '',
        stdout: args.includes(`name=^${cacheName}$`)
          ? `${JSON.stringify({ Name: cacheName, Labels: labels })}\n`
          : '',
      })
    );
    const resources = await inspectSupabaseReplayResources(
      projectId,
      runCommand
    );
    expect(resources.volumes).toHaveLength(1);
    expect(() =>
      assertSupabaseReplayResources(
        resources,
        expectedSupabaseReplayResources({}, projectId),
        {
          projectId,
          allowPartial: true,
        }
      )
    ).toThrow(/volume-unexpected/);
  });

  it.each([
    '',
    'com.supabase.cli.project=foreign',
  ])('detects an exact database volume with foreign or missing labels: %s', async (labels) => {
    const name = `supabase_db_${projectId}`;
    const runCommand = vi.fn(
      async (_command: string, args: readonly string[]) => ({
        stderr: '',
        stdout: args.includes(`name=^${name}$`)
          ? `${JSON.stringify({ Name: name, Labels: labels })}\n`
          : '',
      })
    );
    const resources = await inspectSupabaseReplayResources(
      projectId,
      runCommand
    );
    expect(resources.volumes).toHaveLength(1);
    expect(() =>
      assertSupabaseReplayResources(
        resources,
        expectedSupabaseReplayResources({}, projectId),
        {
          projectId,
          allowPartial: true,
        }
      )
    ).toThrow(/volume-unexpected/);
  });

  it.each([
    'db',
    'edge_runtime',
  ])('deduplicates matching %s volume and rejects inconsistent labels', async (kind) => {
    const cacheName = `supabase_${kind}_${projectId}`;
    let changed = false;
    const runCommand = vi.fn(
      async (_command: string, args: readonly string[]) => {
        if (
          args[0] !== 'volume' ||
          (args.some((arg) => arg.startsWith('name=^')) &&
            !args.includes(`name=^${cacheName}$`))
        )
          return { stderr: '', stdout: '' };
        const labels =
          changed && args.includes(`name=^${cacheName}$`)
            ? 'com.supabase.cli.project=foreign'
            : `${SUPABASE_PROJECT_LABEL}=${projectId}`;
        return {
          stderr: '',
          stdout: `${JSON.stringify({ Name: cacheName, Labels: labels })}\n`,
        };
      }
    );
    const resources = await inspectSupabaseReplayResources(
      projectId,
      runCommand
    );
    expect(resources.volumes).toHaveLength(1);
    changed = true;
    await expect(
      inspectSupabaseReplayResources(projectId, runCommand)
    ).rejects.toThrow(/^Docker replay resource output is invalid$/);
  });

  it('lists every exact-label Docker resource without a shell command', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({
        stderr: '',
        stdout: `${JSON.stringify({
          Image: 'public.ecr.aws/supabase/postgres:17.6.1.156',
          Labels: `${SUPABASE_PROJECT_LABEL}=${projectId}`,
          Names: `supabase_db_${projectId}`,
        })}\n`,
      })
      .mockResolvedValueOnce({
        stderr: '',
        stdout: `${JSON.stringify({
          Labels: `${SUPABASE_PROJECT_LABEL}=${projectId}`,
          Name: `supabase_db_${projectId}`,
        })}\n`,
      })
      .mockResolvedValueOnce({ stderr: '', stdout: '' })
      .mockResolvedValueOnce({ stderr: '', stdout: '' })
      .mockResolvedValueOnce({ stderr: '', stdout: '' });

    const resources = await inspectSupabaseReplayResources(
      projectId,
      runCommand
    );

    expect(runCommand.mock.calls.map(([, args]) => args)).toEqual([
      [
        'ps',
        '-a',
        '--filter',
        `label=${SUPABASE_PROJECT_LABEL}=${projectId}`,
        '--format',
        '{{json .}}',
      ],
      [
        'volume',
        'ls',
        '--filter',
        `label=${SUPABASE_PROJECT_LABEL}=${projectId}`,
        '--format',
        '{{json .}}',
      ],
      [
        'network',
        'ls',
        '--filter',
        `label=${SUPABASE_PROJECT_LABEL}=${projectId}`,
        '--format',
        '{{json .}}',
      ],
      [
        'volume',
        'ls',
        '--filter',
        `name=^supabase_db_${projectId}$`,
        '--format',
        '{{json .}}',
      ],
      [
        'volume',
        'ls',
        '--filter',
        `name=^supabase_edge_runtime_${projectId}$`,
        '--format',
        '{{json .}}',
      ],
    ]);
    expect(resources.containers[0]).toMatchObject({
      image: 'public.ecr.aws/supabase/postgres:17.6.1.156',
      name: `supabase_db_${projectId}`,
    });
    expect(resources.volumes[0]?.labels[SUPABASE_PROJECT_LABEL]).toBe(
      projectId
    );
    expect(resources.networks).toEqual([]);
  });

  it.each([
    'credential=secret',
    'null',
    '42',
    '"primitive"',
    '[]',
    '{"Image":"image","Labels":null,"Names":"container"}',
    '{"Image":"image","Labels":"malformed","Names":"container"}',
    '{"Image":"image","Labels":"key=value","Names":42}',
    '{"Image":{},"Labels":"key=value","Names":"container"}',
  ])('rejects invalid Docker JSON rows without returning raw output', async (row) => {
    const runCommand = vi.fn(async (_command, args) => ({
      stderr: '',
      stdout: args[0] === 'ps' ? `${row}\n` : '',
    }));

    await expect(
      inspectSupabaseReplayResources(projectId, runCommand)
    ).rejects.toThrow(/^Docker replay resource output is invalid$/);
  });
});
