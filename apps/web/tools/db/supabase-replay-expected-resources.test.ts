import { describe, expect, it } from 'vitest';
import {
  assertSupabaseReplayResources,
  expectedSupabaseReplayResources,
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
  it('classifies mismatches without exposing resource names or labels', () => {
    const expected = expectedSupabaseReplayResources({}, projectId);
    const missing = observed();
    missing.networks = [];
    expect(() =>
      assertSupabaseReplayResources(missing, expected, {
        allowPartial: false,
        projectId,
      })
    ).toThrow(
      /^Supabase replay resource verification failed \(network-missing\)$/
    );

    const foreign = observed();
    foreign.volumes[0] = {
      name: 'secret-name',
      labels: { [SUPABASE_PROJECT_LABEL]: 'secret-label' },
    };
    expect(() =>
      assertSupabaseReplayResources(foreign, expected, {
        allowPartial: false,
        projectId,
      })
    ).toThrow(
      /^Supabase replay resource verification failed \(volume-unexpected\)$/
    );

    const wrongImage = observed();
    wrongImage.containers[0].image = 'private-registry/secret-image';
    expect(() =>
      assertSupabaseReplayResources(wrongImage, expected, {
        allowPartial: false,
        projectId,
      })
    ).toThrow(
      /^Supabase replay resource verification failed \(container-image\)$/
    );
  });

  it('classifies duplicate resources and redacts unexpected exceptions', () => {
    const expected = expectedSupabaseReplayResources({}, projectId);
    const duplicate = observed();
    duplicate.volumes.push(duplicate.volumes[0]);
    expect(() =>
      assertSupabaseReplayResources(duplicate, expected, {
        allowPartial: true,
        projectId,
      })
    ).toThrow(
      /^Supabase replay resource verification failed \(volume-duplicate\)$/
    );

    const broken = observed();
    Object.defineProperty(broken, 'containers', {
      get() {
        throw new Error('private resource details');
      },
    });
    expect(() =>
      assertSupabaseReplayResources(broken, expected, {
        allowPartial: false,
        projectId,
      })
    ).toThrow(/^Supabase replay resource verification failed$/);
  });
  it('accepts the exact complete owned resource set', () => {
    expect(() =>
      assertSupabaseReplayResources(
        observed(),
        expectedSupabaseReplayResources({}, projectId),
        { allowPartial: false, projectId }
      )
    ).not.toThrow();
  });

  it('accepts only the exact project-labeled optional pg-delta cache volume', () => {
    const expected = expectedSupabaseReplayResources({}, projectId);
    const resources = observed();
    resources.volumes.push({
      name: `supabase_edge_runtime_${projectId}`,
      labels: { [SUPABASE_PROJECT_LABEL]: projectId },
    });
    expect(() =>
      assertSupabaseReplayResources(resources, expected, {
        allowPartial: false,
        projectId,
      })
    ).not.toThrow();
    resources.volumes[1].labels[SUPABASE_PROJECT_LABEL] = 'other';
    expect(() =>
      assertSupabaseReplayResources(resources, expected, {
        allowPartial: false,
        projectId,
      })
    ).toThrow(/volume-unexpected/);
    resources.volumes[1] = {
      name: `supabase_edge_runtime_${projectId}_extra`,
      labels: { [SUPABASE_PROJECT_LABEL]: projectId },
    };
    expect(() =>
      assertSupabaseReplayResources(resources, expected, {
        allowPartial: false,
        projectId,
      })
    ).toThrow(/volume-unexpected/);
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
    ).toThrow(
      /^Supabase replay resource verification failed \(container-missing\)$/
    );

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
    ).toThrow(
      /^Supabase replay resource verification failed \(container-unexpected\)$/
    );
  });
});
