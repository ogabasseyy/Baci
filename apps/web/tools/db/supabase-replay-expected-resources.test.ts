import { describe, expect, it, vi } from 'vitest';
import {
  assertSupabaseReplayResources,
  expectedSupabaseReplayResources,
  inspectSupabaseReplayResources,
  type ObservedSupabaseReplayResources,
  SUPABASE_PROJECT_LABEL,
} from './supabase-replay-expected-resources';

const projectId = 'baci_replay_abc123';

function observed(
  options: {
    imageTransformationEnabled?: boolean;
    poolerEnabled?: boolean;
  } = {}
): ObservedSupabaseReplayResources {
  const expected = expectedSupabaseReplayResources(options, projectId);
  return {
    containers: expected.containers.map(({ image, name }) => ({
      image,
      labels: { [SUPABASE_PROJECT_LABEL]: projectId },
      name,
    })),
    networks: expected.networks.map((name) => ({
      labels: { [SUPABASE_PROJECT_LABEL]: projectId },
      name,
    })),
    volumes: expected.volumes.map((name) => ({
      labels: { [SUPABASE_PROJECT_LABEL]: projectId },
      name,
    })),
  };
}

describe('expectedSupabaseReplayResources', () => {
  it('binds replay ownership to the database-only resource set', () => {
    const resources = expectedSupabaseReplayResources({}, projectId);

    expect(resources.containers.map(({ name }) => name)).toEqual([
      'supabase_db_baci_replay_abc123',
    ]);
    expect(resources.containers[0]).toEqual({
      image: 'public.ecr.aws/supabase/postgres:17.6.1.156',
      name: 'supabase_db_baci_replay_abc123',
    });
    expect(resources.volumes).toEqual(['supabase_db_baci_replay_abc123']);
    expect(resources.networks).toEqual(['supabase_network_baci_replay_abc123']);
  });

  it('does not expand replay resources when unrelated services are enabled in config', () => {
    const resources = expectedSupabaseReplayResources(
      { imageTransformationEnabled: true, poolerEnabled: true },
      projectId
    );

    expect(resources.containers.map(({ name }) => name)).toEqual([
      'supabase_db_baci_replay_abc123',
    ]);
    expect(resources.volumes).toEqual(['supabase_db_baci_replay_abc123']);
  });
});

describe('assertSupabaseReplayResources', () => {
  it('accepts the exact complete owned resource set', () => {
    expect(() =>
      assertSupabaseReplayResources(
        observed(),
        expectedSupabaseReplayResources({}, projectId),
        { allowPartial: false, projectId }
      )
    ).not.toThrow();
  });

  it('accepts a correctly labeled partial subset only during cleanup', () => {
    const resources = observed();
    resources.containers = resources.containers.slice(0, 2);
    resources.volumes = [];

    expect(() =>
      assertSupabaseReplayResources(
        resources,
        expectedSupabaseReplayResources({}, projectId),
        { allowPartial: true, projectId }
      )
    ).not.toThrow();
  });

  it('rejects missing, mislabeled, wrong-prefix, or wrong-image resources', () => {
    const expected = expectedSupabaseReplayResources({}, projectId);
    const missing = observed();
    missing.containers.pop();
    expect(() =>
      assertSupabaseReplayResources(missing, expected, {
        allowPartial: false,
        projectId,
      })
    ).toThrow(/^Supabase replay resource verification failed$/);

    const malformed = observed();
    malformed.containers[0] = {
      image: 'supabase/postgres:latest',
      labels: { [SUPABASE_PROJECT_LABEL]: 'other' },
      name: 'unowned_db',
    };
    expect(() =>
      assertSupabaseReplayResources(malformed, expected, {
        allowPartial: true,
        projectId,
      })
    ).toThrow(/^Supabase replay resource verification failed$/);
  });
});

describe('inspectSupabaseReplayResources', () => {
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
